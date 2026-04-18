import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { refreshRetailCrmOrderContext } from '@/lib/retailcrm-order-context';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.order_context_refresh';
const MAX_CONTEXT_CONCURRENCY = 2;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isSystemJobsPipelineRuntimeEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const claimed = await claimSystemJobs({
      workerId: `order-context-refresh:${Date.now()}`,
      jobTypes: ['retailcrm_order_context_refresh'],
      limit: MAX_CONTEXT_CONCURRENCY,
      lockSeconds: 240,
      maxProcessing: MAX_CONTEXT_CONCURRENCY,
      concurrencyKey: 'system_jobs.order_context_refresh',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as {
        order_id?: number | string;
        source?: string;
        order_updated_at?: string | null;
      };
      const orderId = payload.order_id ? Number(payload.order_id) : NaN;

      if (!Number.isFinite(orderId) || orderId <= 0) {
        await failSystemJob(job.id, 'Missing or invalid order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const contextResult = await refreshRetailCrmOrderContext({ orderId });

        if (contextResult.status === 'skipped_not_found') {
          await completeSystemJob(job.id, {
            order_id: orderId,
            result: 'skipped_not_found',
            source: payload.source || 'retailcrm_order_context_refresh',
          });

          results.push({
            job_id: job.id,
            order_id: orderId,
            status: 'skipped_not_found',
          });
          continue;
        }

        await enqueueOrderRefreshJob({
          jobType: 'order_score_refresh',
          orderId,
          source: payload.source || 'retailcrm_order_context_refresh',
          payload: {
            order_updated_at: contextResult.orderUpdatedAt || payload.order_updated_at || null,
            context_refreshed_at: contextResult.contextRefreshedAt,
          },
          priority: 25,
          parentJobId: job.id,
        });

        await enqueueOrderRefreshJob({
          jobType: 'order_insight_refresh',
          orderId,
          source: payload.source || 'retailcrm_order_context_refresh',
          payload: {
            order_updated_at: contextResult.orderUpdatedAt || payload.order_updated_at || null,
            context_refreshed_at: contextResult.contextRefreshedAt,
          },
          priority: 35,
          parentJobId: job.id,
        });

        await completeSystemJob(job.id, {
          order_id: orderId,
          retailcrm_order_id: contextResult.retailcrmOrderId,
          manager_id: contextResult.managerId,
          manager_name: contextResult.managerName,
          context_refreshed_at: contextResult.contextRefreshedAt,
          next_jobs: ['order_score_refresh', 'order_insight_refresh'],
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          retailcrm_order_id: contextResult.retailcrmOrderId,
          status: 'completed',
          manager_id: contextResult.managerId,
        });
      } catch (error: any) {
        const retry = getAdaptiveSystemJobRetry({
          attempts: job.attempts || 0,
          errorMessage: error.message || 'Unknown order context refresh worker error',
          profile: 'fast',
        });
        await failSystemJob(job.id, error.message || 'Unknown order context refresh worker error', retry.retryDelaySeconds);
        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'failed',
          error: error.message,
          retry_kind: retry.retryKind,
          retry_delay_seconds: retry.retryDelaySeconds,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });

    return NextResponse.json({
      ok: true,
      status: 'processed',
      processed: results.length,
      results,
    });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown order context refresh route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}