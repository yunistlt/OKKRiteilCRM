import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueSystemJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
  safeEnqueueSystemJob,
} from '@/lib/system-jobs';
import {
  fetchRetailCrmOrdersPage,
  getRetailCrmOrderCursor,
  getRetailCrmOrderVersion,
} from '@/lib/retailcrm-orders';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.retailcrm_order_delta';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getRetryDelay(attempts: number) {
  if (attempts <= 1) return 30;
  if (attempts === 2) return 120;
  if (attempts === 3) return 300;
  return 900;
}

function getSeedKey() {
  return `retailcrm_order_delta_pull:${new Date().toISOString().slice(0, 16)}`;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    await safeEnqueueSystemJob({
      jobType: 'retailcrm_order_delta_pull',
      payload: { seeded_at: new Date().toISOString() },
      priority: 10,
      idempotencyKey: getSeedKey(),
      maxAttempts: 5,
    });

    const claimed = await claimSystemJobs({
      workerId: `retailcrm-order-delta:${Date.now()}`,
      jobTypes: ['retailcrm_order_delta_pull'],
      limit: 1,
      lockSeconds: 240,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const job = claimed[0];
    try {
      const payload = (job.payload || {}) as { force?: boolean; days?: number };
      const startTime = Date.now();
      const maxTimeMs = 45000;
      const maxPagesPerRun = 2;
      let filterDateFrom = '';

      if (!payload.force) {
        const { data: state } = await supabase
          .from('sync_state')
          .select('value')
          .eq('key', 'retailcrm_orders_sync')
          .single();

        if (state?.value) {
          const lastSync = new Date(state.value);
          lastSync.setMinutes(lastSync.getMinutes() - 5);
          filterDateFrom = lastSync.toISOString().slice(0, 19).replace('T', ' ');
        }
      }

      if (!filterDateFrom) {
        const defaultLookback = new Date();
        defaultLookback.setDate(defaultLookback.getDate() - (payload.days ?? 2));
        filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');
      }

      let page = 1;
      let pagesProcessed = 0;
      let queuedJobs = 0;
      let maxCursorFound: Date | null = null;
      let hasMore = true;

      while (hasMore && pagesProcessed < maxPagesPerRun && Date.now() - startTime < maxTimeMs) {
        const { orders, pagination } = await fetchRetailCrmOrdersPage({
          page,
          limit: 50,
          createdAtFrom: filterDateFrom,
        });

        if (!orders.length) {
          hasMore = false;
          break;
        }

        for (const order of orders) {
          const orderCursor = getRetailCrmOrderCursor(order);
          if (orderCursor && (!maxCursorFound || orderCursor > maxCursorFound)) {
            maxCursorFound = orderCursor;
          }

          await enqueueSystemJob({
            jobType: 'retailcrm_order_upsert',
            payload: {
              order,
              source: 'retailcrm_order_delta_pull',
            },
            priority: 20,
            idempotencyKey: `retailcrm_order_upsert:${order.id}:${getRetailCrmOrderVersion(order)}`,
            maxAttempts: 5,
            parentJobId: job.id,
          });
          queuedJobs += 1;
        }

        pagesProcessed += 1;
        if (pagination && pagination.currentPage < pagination.totalPageCount) {
          page += 1;
        } else {
          hasMore = false;
        }
      }

      if (maxCursorFound) {
        await supabase
          .from('sync_state')
          .upsert({
            key: 'retailcrm_orders_sync',
            value: maxCursorFound.toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
      }

      await supabase
        .from('sync_state')
        .upsert({
          key: 'retailcrm_orders_queue_last_success_at',
          value: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      await completeSystemJob(job.id, {
        queued_jobs: queuedJobs,
        pages_processed: pagesProcessed,
        filter_date_from: filterDateFrom,
        last_cursor_stored: maxCursorFound?.toISOString() || null,
      });

      await recordWorkerSuccess(WORKER_KEY, {
        queued_jobs: queuedJobs,
        pages_processed: pagesProcessed,
      });

      return NextResponse.json({
        ok: true,
        status: 'processed',
        queued_jobs: queuedJobs,
        pages_processed: pagesProcessed,
        filter_date_from: filterDateFrom,
        last_cursor_stored: maxCursorFound?.toISOString() || null,
      });
    } catch (error: any) {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm delta worker error');
      await failSystemJob(job.id, error.message || 'Unknown retailcrm delta worker error', getRetryDelay(job.attempts || 0));
      throw error;
    }
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm delta route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}