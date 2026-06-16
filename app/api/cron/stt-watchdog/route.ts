import { NextRequest, NextResponse } from 'next/server';
import { isSystemJobsPipelineRuntimeEnabled } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { isSttPullMode } from '@/lib/transcribe';
import { sendTelegramNotification } from '@/lib/telegram';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'system_jobs.stt_watchdog';
const ALERT_KEY = 'stt_watchdog_alerted';
// «Не тянет»: есть заметный бэклог, но прогресса почти нет за последний час.
const BACKLOG_MIN = 30;       // меньше — не алармим (мелкая очередь рассосётся)
const DONE_PER_HOUR_MIN = 10; // меньше обработанных/час при бэклоге → воркер встал/ползёт

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

async function setAlerted(value: boolean) {
  await supabase.from('sync_state').upsert(
    { key: ALERT_KEY, value: value ? '1' : '', updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

// Алертит в Telegram, если внешний STT-воркер перестал забирать звонки, хотя в очереди есть работа.
// Анти-спам: алерт «упал» шлётся один раз; «восстановился» — один раз при возобновлении.
export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    // Сторожим только pull-режим (внешний воркер). Иначе нечего сторожить.
    if (!isSttPullMode() || !(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const { data, error } = await supabase.rpc('stt_queue_status');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const lastActivity = row?.last_activity ? new Date(row.last_activity) : null;
    const waiting = Number(row?.waiting ?? 0);
    const doneLastHour = Number(row?.done_last_hour ?? 0);
    const minutesSince = lastActivity ? Math.round((Date.now() - lastActivity.getTime()) / 60000) : null;

    // Воркер «не тянет»: есть заметный бэклог, но за час почти ничего не обработано.
    const stalled = waiting >= BACKLOG_MIN && doneLastHour < DONE_PER_HOUR_MIN;

    const { data: st } = await supabase.from('sync_state').select('value').eq('key', ALERT_KEY).maybeSingle();
    const alerted = st?.value === '1';

    let action = 'none';
    if (stalled && !alerted) {
      await sendTelegramNotification(
        `⚠️ STT-воркер не тянет: за час обработано ${doneLastHour}, в очереди ${waiting} звонков на расшифровку` +
        (minutesSince !== null ? ` (последняя активность ${minutesSince} мин назад)` : '') + `.\n` +
        `Проверьте воркер на Timeweb: systemctl status stt-worker`,
      );
      await setAlerted(true);
      action = 'alerted';
    } else if (!stalled && alerted) {
      await sendTelegramNotification(`✅ STT-воркер снова в норме (за час обработано ${doneLastHour}).`);
      await setAlerted(false);
      action = 'recovered';
    }

    await recordWorkerSuccess(WORKER_KEY, { waiting, done_last_hour: doneLastHour, minutes_since: minutesSince, action });
    return NextResponse.json({ ok: true, waiting, done_last_hour: doneLastHour, minutes_since: minutesSince, stalled, action });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown stt-watchdog error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
  }
}
