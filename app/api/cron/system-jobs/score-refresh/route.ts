import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  enqueueManagerAggregateRefreshJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
} from '@/lib/system-jobs';
import { evaluateOrder } from '@/lib/okk-evaluator';
import { refreshStoredPriorityForOrder } from '@/lib/prioritization';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.score_refresh';
const MAX_SCORE_CONCURRENCY = 2;

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function getRetryDelay(attempts: number) {
  if (attempts <= 1) return 60;
  if (attempts === 2) return 180;
  if (attempts === 3) return 600;
  return 1800;
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const workerId = `score-refresh-worker:${Date.now()}`;
    const claimed = await claimSystemJobs({
      workerId,
      jobTypes: ['order_score_refresh'],
      limit: MAX_SCORE_CONCURRENCY,
      lockSeconds: 240,
      maxProcessing: MAX_SCORE_CONCURRENCY,
      concurrencyKey: 'system_jobs.order_score_refresh',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { order_id?: number | string };
      const rawOrderId = payload.order_id;
      const orderId = rawOrderId ? Number(rawOrderId) : NaN;

      if (!Number.isFinite(orderId) || orderId <= 0) {
        await failSystemJob(job.id, 'Missing or invalid order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        await evaluateOrder(orderId);

        const priorityResult = await refreshStoredPriorityForOrder(orderId, true);
        const managerId = priorityResult.managerId ? Number(priorityResult.managerId) : null;

        if (managerId) {
          await enqueueManagerAggregateRefreshJob({
            managerId,
            source: 'score_refresh_worker',
            payload: {
              order_id: orderId,
              priority_status: priorityResult.status,
            },
            priority: 45,
            parentJobId: job.id,
          });
        }

        await completeSystemJob(job.id, {
          order_id: orderId,
          processed: 1,
          errors: 0,
          priority_status: priorityResult.status,
          manager_id: managerId,
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'completed',
          processed: 1,
          errors: 0,
          priority_status: priorityResult.status,
          manager_id: managerId,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown score refresh worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown score refresh route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}