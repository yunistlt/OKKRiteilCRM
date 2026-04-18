import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  getAdaptiveSystemJobRetry,
  isSystemJobsPipelineRuntimeEnabled,
} from '@/lib/system-jobs';
import { runInsightAnalysisDetailed } from '@/lib/insight-agent';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.order_insight_refresh';
const MAX_INSIGHT_CONCURRENCY = 1;

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
      workerId: `order-insight-refresh:${Date.now()}`,
      jobTypes: ['order_insight_refresh'],
      limit: MAX_INSIGHT_CONCURRENCY,
      lockSeconds: 300,
      maxProcessing: MAX_INSIGHT_CONCURRENCY,
      concurrencyKey: 'system_jobs.order_insight_refresh',
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { order_id?: number; source?: string };
      const orderId = payload.order_id;

      if (!orderId) {
        await failSystemJob(job.id, 'Missing order_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const insightResult = await runInsightAnalysisDetailed(orderId);

        if (insightResult.status === 'failed') {
          throw new Error(insightResult.errorMessage || 'Unknown insight worker error');
        }

        await completeSystemJob(job.id, {
          order_id: orderId,
          source: payload.source || 'order_insight_refresh',
          result: insightResult.status,
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          status: insightResult.status === 'updated' ? 'completed' : 'skipped_no_metrics',
        });
      } catch (error: any) {
        const retry = getAdaptiveSystemJobRetry({
          attempts: job.attempts || 0,
          errorMessage: error.message || 'Unknown insight worker error',
          profile: 'slow',
        });
        await failSystemJob(job.id, error.message || 'Unknown insight worker error', retry.retryDelaySeconds);
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
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown insight refresh route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}