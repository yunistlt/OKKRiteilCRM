import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  claimProcessablePayments,
  processPointPayment,
  notifyPendingForReview,
  resendRequestedNotifications,
} from '@/lib/payments/service';
import { supabase } from '@/utils/supabase';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

// Воркер сервиса распределения платежей.
// Сканирует point_payments: новые (pending_match) матчит на заказы, при уверенном
// совпадении и проверенной подписи разносит платёж в заказ ОКК; привязанные, но не
// разнесённые — ретраит. Неоднозначные остаются в очереди на ручной разбор.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.point_payment_ingest';

function ensureAuthorized(req: NextRequest) {
  if (!isCronHeaderAuthorized(req)) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    const rows = await claimProcessablePayments(10);

    const results: Array<Record<string, any>> = [];
    for (const row of rows) {
      try {
        const res = await processPointPayment(row);
        results.push({ payment_id: row.id, status: res.status });
      } catch (err: any) {
        // Ошибку фиксируем в строке, не роняя весь батч.
        await supabase
          .from('point_payments')
          .update({
            posting_error: String(err?.message || err).slice(0, 1500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        results.push({ payment_id: row.id, status: 'error', error: String(err?.message || err) });
      }
    }

    // Напоминание о неразобранных поступлениях: деньги пришли, но не привязаны к заказу —
    // значит, не разнесены и заказ не уходит в производство. Не критично для воркера.
    let pendingNotified = 0;
    try {
      pendingNotified = await notifyPendingForReview();
    } catch (e: any) {
      console.error('[payments] notifyPendingForReview failed:', e?.message || e);
    }

    // Досылка по просьбе человека: сообщение ушло не в тот чат или не ушло вовсе.
    // Сбой досылки не должен ронять воркер — деньги важнее повторного сообщения.
    let resent = 0;
    try {
      resent = await resendRequestedNotifications();
    } catch (e: any) {
      console.error('[payments] resendRequestedNotifications failed:', e?.message || e);
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length, pendingNotified, resent });
    return NextResponse.json({
      ok: true,
      status: results.length || pendingNotified || resent ? 'processed' : 'idle',
      processed: results.length,
      pendingNotified,
      resent,
      results,
    });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'point payment ingest route error');
    }
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.message === 'Unauthorized' ? 401 : 500 },
    );
  }
}
