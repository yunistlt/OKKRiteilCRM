import { NextRequest, NextResponse } from 'next/server';
import {
  claimProcessablePayments,
  processPointPayment,
  reconcileCrmPostings,
} from '@/lib/payments/service';
import { supabase } from '@/utils/supabase';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

// Воркер сервиса распределения платежей.
// Сканирует point_payments: новые (pending_match) матчит на заказы, при уверенном
// совпадении и проверенной подписи пробрасывает платёж в RetailCRM; привязанные,
// но не проброшенные — ретраит. Неоднозначные остаются в очереди на ручной разбор.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.point_payment_ingest';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
            retailcrm_error: String(err?.message || err).slice(0, 1500),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        results.push({ payment_id: row.id, status: 'error', error: String(err?.message || err) });
      }
    }

    // Сверка проводок с RetailCRM — держим crm_posting честным (удалили/изменили/внесли вручную).
    // Не критично и не трогает факт прихода; сбой не должен ронять воркер.
    let reconciled = 0;
    try {
      reconciled = await reconcileCrmPostings(10);
    } catch (e: any) {
      console.error('[Tochka] reconcileCrmPostings failed:', e?.message || e);
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length, reconciled });
    return NextResponse.json({
      ok: true,
      status: results.length || reconciled ? 'processed' : 'idle',
      processed: results.length,
      reconciled,
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
