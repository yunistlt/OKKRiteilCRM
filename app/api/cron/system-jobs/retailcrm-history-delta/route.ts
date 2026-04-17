import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineEnabled,
  safeEnqueueSystemJob,
} from '@/lib/system-jobs';
import { fetchRetailCrmHistoryPage } from '@/lib/retailcrm-orders';
import { recordRetailCrmSyncFailure, recordRetailCrmSyncSuccess } from '@/lib/retailcrm-sync-state';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.retailcrm_history_delta';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getSeedKey() {
  return `retailcrm_history_delta_pull:${new Date().toISOString().slice(0, 16)}`;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    await safeEnqueueSystemJob({
      jobType: 'retailcrm_history_delta_pull',
      payload: { seeded_at: new Date().toISOString() },
      priority: 12,
      idempotencyKey: getSeedKey(),
      maxAttempts: 5,
    });

    const claimed = await claimSystemJobs({
      workerId: `retailcrm-history-delta:${Date.now()}`,
      jobTypes: ['retailcrm_history_delta_pull'],
      limit: 1,
      lockSeconds: 240,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const job = claimed[0];
    try {
      const payload = (job.payload || {}) as { force?: boolean };
      const startTime = Date.now();
      const maxTimeMs = 45000;
      const maxPagesPerRun = 2;
      let startDate = '2025-01-01 00:00:00';

      if (!payload.force) {
        const { data: state } = await supabase
          .from('sync_state')
          .select('value')
          .eq('key', 'retailcrm_history_sync')
          .single();

        if (state?.value) {
          const buffered = new Date(state.value);
          buffered.setMinutes(buffered.getMinutes() - 5);
          startDate = buffered.toISOString().slice(0, 19).replace('T', ' ');
        } else {
          const { data: lastEntry } = await supabase
            .from('order_history_log')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

          if (lastEntry?.occurred_at) {
            const buffered = new Date(lastEntry.occurred_at);
            buffered.setMinutes(buffered.getMinutes() - 5);
            startDate = buffered.toISOString().slice(0, 19).replace('T', ' ');
          }
        }
      }

      let page = 1;
      let hasMore = true;
      let pagesProcessed = 0;
      let rowsUpserted = 0;
      let jobsQueued = 0;
      let maxOccurredAt: Date | null = null;

      while (hasMore && pagesProcessed < maxPagesPerRun && Date.now() - startTime < maxTimeMs) {
        const { history, pagination } = await fetchRetailCrmHistoryPage({
          page,
          limit: 50,
          startDate,
        });

        if (!history.length) {
          hasMore = false;
          break;
        }

        const rowsToUpsert = [];
        const lastHistoryIdByOrder = new Map<number, number>();

        for (const item of history) {
          if (!item.order?.id) {
            continue;
          }

          rowsToUpsert.push({
            retailcrm_history_id: item.id,
            retailcrm_order_id: item.order.id,
            field: item.field,
            old_value: typeof item.oldValue === 'object' ? JSON.stringify(item.oldValue) : String(item.oldValue ?? ''),
            new_value: typeof item.newValue === 'object' ? JSON.stringify(item.newValue) : String(item.newValue ?? ''),
            user_data: item.user || null,
            occurred_at: item.createdAt,
          });

          const occurredAt = item.createdAt ? new Date(item.createdAt) : null;
          if (occurredAt && (!maxOccurredAt || occurredAt > maxOccurredAt)) {
            maxOccurredAt = occurredAt;
          }

          lastHistoryIdByOrder.set(item.order.id, Math.max(lastHistoryIdByOrder.get(item.order.id) || 0, item.id));
        }

        if (rowsToUpsert.length) {
          const { error } = await supabase
            .from('order_history_log')
            .upsert(rowsToUpsert, { onConflict: 'retailcrm_history_id' });

          if (error) {
            throw error;
          }

          rowsUpserted += rowsToUpsert.length;

          for (const [orderId, historyId] of Array.from(lastHistoryIdByOrder.entries())) {
            await enqueueSystemJob({
              jobType: 'retailcrm_order_upsert',
              payload: {
                order_id: orderId,
                source: 'retailcrm_history_delta_pull',
                retailcrm_history_id: historyId,
              },
              priority: 18,
              idempotencyKey: `retailcrm_order_upsert:history:${orderId}:${historyId}`,
              maxAttempts: 5,
              parentJobId: job.id,
            });
            jobsQueued += 1;
          }
        }

        pagesProcessed += 1;
        if (pagination && pagination.currentPage < pagination.totalPageCount) {
          page += 1;
        } else {
          hasMore = false;
        }
      }

      await recordRetailCrmSyncSuccess({
        cursorKey: 'retailcrm_history_sync',
        successKey: 'retailcrm_history_queue_last_success_at',
        lagKey: 'retailcrm_history_lag_seconds',
        errorKey: 'retailcrm_history_last_error',
        cursorValue: maxOccurredAt?.toISOString() || null,
      });

      await completeSystemJob(job.id, {
        rows_upserted: rowsUpserted,
        jobs_queued: jobsQueued,
        pages_processed: pagesProcessed,
        start_date: startDate,
        last_cursor_stored: maxOccurredAt?.toISOString() || null,
      });

      await recordWorkerSuccess(WORKER_KEY, {
        rows_upserted: rowsUpserted,
        jobs_queued: jobsQueued,
        pages_processed: pagesProcessed,
      });

      return NextResponse.json({
        ok: true,
        status: 'processed',
        rows_upserted: rowsUpserted,
        jobs_queued: jobsQueued,
        pages_processed: pagesProcessed,
        start_date: startDate,
        last_cursor_stored: maxOccurredAt?.toISOString() || null,
      });
    } catch (error: any) {
      const retry = getAdaptiveSystemJobRetry({
        attempts: job.attempts || 0,
        errorMessage: error.message || 'Unknown retailcrm history worker error',
        profile: 'fast',
      });
      await recordRetailCrmSyncFailure({
        errorKey: 'retailcrm_history_last_error',
        message: error.message || 'Unknown retailcrm history worker error',
      });
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm history worker error');
      await failSystemJob(job.id, error.message || 'Unknown retailcrm history worker error', retry.retryDelaySeconds);
      throw error;
    }
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordRetailCrmSyncFailure({
        errorKey: 'retailcrm_history_last_error',
        message: error.message || 'Unknown retailcrm history route error',
      });
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm history route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}