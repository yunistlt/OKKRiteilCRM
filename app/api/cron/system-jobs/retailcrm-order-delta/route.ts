import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
  safeEnqueueSystemJob,
} from '@/lib/system-jobs';
import {
  buildRetailCrmSlowPathUpdatedAtFrom,
  buildRetailCrmUpdatedAtFrom,
  fetchRetailCrmOrdersPage,
  getRetailCrmDeltaCadenceSeconds,
  getRetailCrmMoscowHour,
  getRetailCrmPageWindow,
  getRetailCrmOrderCursor,
  getRetailCrmOrderVersion,
  isRetailCrmCatchUpMode,
  shouldRunRetailCrmSlowPath,
} from '@/lib/retailcrm-orders';
import { recordRetailCrmSyncFailure, recordRetailCrmSyncSuccess } from '@/lib/retailcrm-sync-state';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.retailcrm_order_delta';
const MAX_RETAILCRM_DELTA_CONCURRENCY = 1;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getSeedKey() {
  return `retailcrm_order_delta_pull:${new Date().toISOString().slice(0, 16)}`;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
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
      maxProcessing: MAX_RETAILCRM_DELTA_CONCURRENCY,
      concurrencyKey: 'system_jobs.retailcrm_order_delta',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const job = claimed[0];
    try {
      const payload = (job.payload || {}) as { force?: boolean; days?: number };
      const startTime = Date.now();
      const maxTimeMs = 45000;
      const now = new Date();
      const { data: state } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', 'retailcrm_orders_sync')
        .single();
      const { data: successState } = await supabase
        .from('sync_state')
        .select('value, updated_at')
        .eq('key', 'retailcrm_orders_queue_last_success_at')
        .single();
      const { data: slowPathState } = await supabase
        .from('sync_state')
        .select('value, updated_at')
        .eq('key', 'retailcrm_orders_slow_path_last_run')
        .single();

      const cursorValue = state?.value || null;
      const catchUpMode = Boolean(payload.force) || isRetailCrmCatchUpMode(cursorValue);
      const cadenceSeconds = getRetailCrmDeltaCadenceSeconds(now);
      const lastSuccessAt = successState?.value || successState?.updated_at || null;
      const lastSuccessMs = lastSuccessAt ? new Date(lastSuccessAt).getTime() : null;
      const cadenceActive = !payload.force && !catchUpMode && lastSuccessMs !== null && !Number.isNaN(lastSuccessMs) && (now.getTime() - lastSuccessMs) < cadenceSeconds * 1000;

      if (cadenceActive) {
        await completeSystemJob(job.id, {
          skipped_by_cadence: true,
          cadence_seconds: cadenceSeconds,
          last_success_at: lastSuccessAt,
          moscow_hour: getRetailCrmMoscowHour(now),
        });

        return NextResponse.json({
          ok: true,
          status: 'skipped_by_cadence',
          cadence_seconds: cadenceSeconds,
          last_success_at: lastSuccessAt,
          moscow_hour: getRetailCrmMoscowHour(now),
        });
      }

      const slowPathMode = !payload.force && !catchUpMode && shouldRunRetailCrmSlowPath({
        now,
        lastSlowPathAt: slowPathState?.value || slowPathState?.updated_at || null,
      });
      const { limit, maxPagesPerRun } = getRetailCrmPageWindow(catchUpMode);
      const filterDateFrom = slowPathMode
        ? buildRetailCrmSlowPathUpdatedAtFrom(now)
        : buildRetailCrmUpdatedAtFrom({
            cursorValue: payload.force ? null : cursorValue,
            fallbackDays: payload.days ?? 2,
          });

      let page = 1;
      let pagesProcessed = 0;
      let queuedJobs = 0;
      let maxCursorFound: Date | null = null;
      let hasMore = true;

      while (hasMore && pagesProcessed < maxPagesPerRun && Date.now() - startTime < maxTimeMs) {
        const { orders, pagination } = await fetchRetailCrmOrdersPage({
          page,
          limit,
          updatedAtFrom: filterDateFrom,
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

      await recordRetailCrmSyncSuccess({
        cursorKey: 'retailcrm_orders_sync',
        successKey: 'retailcrm_orders_queue_last_success_at',
        lagKey: 'retailcrm_orders_lag_seconds',
        errorKey: 'retailcrm_orders_last_error',
        cursorValue: maxCursorFound?.toISOString() || null,
      });

      if (slowPathMode) {
        await supabase.from('sync_state').upsert({
          key: 'retailcrm_orders_slow_path_last_run',
          value: now.toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: 'key' });
      }

      await completeSystemJob(job.id, {
        queued_jobs: queuedJobs,
        pages_processed: pagesProcessed,
        catch_up_mode: catchUpMode,
        slow_path_mode: slowPathMode,
        cadence_seconds: cadenceSeconds,
        request_limit: limit,
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
        catch_up_mode: catchUpMode,
        slow_path_mode: slowPathMode,
        cadence_seconds: cadenceSeconds,
        request_limit: limit,
        filter_date_from: filterDateFrom,
        last_cursor_stored: maxCursorFound?.toISOString() || null,
      });
    } catch (error: any) {
      const retry = getAdaptiveSystemJobRetry({
        attempts: job.attempts || 0,
        errorMessage: error.message || 'Unknown retailcrm delta worker error',
        profile: 'fast',
      });
      await recordRetailCrmSyncFailure({
        errorKey: 'retailcrm_orders_last_error',
        message: error.message || 'Unknown retailcrm delta worker error',
      });
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm delta worker error');
      await failSystemJob(job.id, error.message || 'Unknown retailcrm delta worker error', retry.retryDelaySeconds);
      throw error;
    }
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordRetailCrmSyncFailure({
        errorKey: 'retailcrm_orders_last_error',
        message: error.message || 'Unknown retailcrm delta route error',
      });
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm delta route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}