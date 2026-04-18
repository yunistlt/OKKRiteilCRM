import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueOrderRefreshJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import {
  fetchRetailCrmOrder,
  getRetailCrmOrderVersion,
  upsertRetailCrmOrders,
} from '@/lib/retailcrm-orders';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.retailcrm_order_upsert';

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
      workerId: `retailcrm-order-upsert:${Date.now()}`,
      jobTypes: ['retailcrm_order_upsert'],
      limit: 5,
      lockSeconds: 240,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as {
        order_id?: number;
        order?: any;
        source?: string;
      };

      const orderId = payload.order_id || payload.order?.id;
      if (!orderId) {
        await failSystemJob(job.id, 'Missing order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const order = payload.order || await fetchRetailCrmOrder(orderId);
        if (!order) {
          await completeSystemJob(job.id, {
            order_id: orderId,
            source: payload.source || 'retailcrm_order_upsert',
            result: 'skipped_not_found',
          });

          results.push({
            job_id: job.id,
            order_id: orderId,
            status: 'skipped_not_found',
            source: payload.source || 'retailcrm_order_upsert',
          });
          continue;
        }

        await upsertRetailCrmOrders([order]);

        const version = getRetailCrmOrderVersion(order);

        await enqueueOrderRefreshJob({
          jobType: 'order_score_refresh',
          orderId,
          source: payload.source || 'retailcrm_order_upsert',
          payload: {
            order_updated_at: version,
          },
          priority: 25,
          parentJobId: job.id,
        });

        await enqueueOrderRefreshJob({
          jobType: 'order_insight_refresh',
          orderId,
          source: payload.source || 'retailcrm_order_upsert',
          payload: {
            order_updated_at: version,
          },
          priority: 35,
          parentJobId: job.id,
        });

        await completeSystemJob(job.id, {
          order_id: orderId,
          order_updated_at: version,
          next_jobs: ['order_score_refresh', 'order_insight_refresh'],
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'completed',
          source: payload.source || 'retailcrm_order_upsert',
        });
      } catch (error: any) {
        const retry = getAdaptiveSystemJobRetry({
          attempts: job.attempts || 0,
          errorMessage: error.message || 'Unknown order upsert worker error',
          profile: 'fast',
        });
        await failSystemJob(job.id, error.message || 'Unknown order upsert worker error', retry.retryDelaySeconds);
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
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown retailcrm order upsert route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}