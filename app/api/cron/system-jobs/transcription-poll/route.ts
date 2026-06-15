import { NextRequest, NextResponse } from 'next/server';
import { isSystemJobsPipelineRuntimeEnabled } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { isSelfHostedSttConfigured, pollSubmittedTranscription } from '@/lib/transcribe';
import { enqueueTranscriptionDownstream } from '@/lib/transcription-downstream';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.transcription_poll';
const POLL_BATCH = 12;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

// Async-режим STT: забирает результаты по сохранённым stt_job_id для звонков в статусе 'submitted'.
// Готово → финализация (диаризация/AMD/запись) + downstream. Ошибка/протухло → fail/пере-submit.
export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }
    if (!isSelfHostedSttConfigured()) {
      return NextResponse.json({ ok: true, status: 'stt_not_configured' });
    }

    const { data: rows, error } = await supabase
      .from('raw_telphin_calls')
      .select('telphin_call_id, stt_job_id, stt_submitted_at')
      .eq('transcription_status', 'submitted')
      .not('stt_job_id', 'is', null)
      .order('stt_submitted_at', { ascending: true })
      .limit(POLL_BATCH);
    if (error) throw error;

    if (!rows || rows.length === 0) {
      await recordWorkerSuccess(WORKER_KEY, { processed: 0 });
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Record<string, any>[] = [];
    for (const row of rows) {
      const callId = row.telphin_call_id as string;
      try {
        const state = await pollSubmittedTranscription(row as any);
        if (state === 'done') {
          const downstream = await enqueueTranscriptionDownstream(callId, 'transcription_poll');
          results.push({ telphin_call_id: callId, state, order_id: downstream.orderId });
        } else {
          results.push({ telphin_call_id: callId, state });
        }
      } catch (e: any) {
        results.push({ telphin_call_id: callId, state: 'exception', error: e?.message });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown transcription-poll error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json({ ok: false, error: error.message }, { status: isUnauthorized ? 401 : 500 });
  }
}
