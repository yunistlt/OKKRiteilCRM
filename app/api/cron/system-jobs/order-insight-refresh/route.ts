import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
} from '@/lib/system-jobs';
import { runInsightAnalysis } from '@/lib/insight-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

    const claimed = await claimSystemJobs({
      workerId: `order-insight-refresh:${Date.now()}`,
      jobTypes: ['order_insight_refresh'],
      limit: 1,
      lockSeconds: 300,
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
        const insights = await runInsightAnalysis(orderId);

        await completeSystemJob(job.id, {
          order_id: orderId,
          source: payload.source || 'order_insight_refresh',
          result: insights ? 'updated' : 'skipped_no_metrics',
        });

        results.push({
          job_id: job.id,
          order_id: orderId,
          status: insights ? 'completed' : 'skipped_no_metrics',
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown insight worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          order_id: orderId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      status: 'processed',
      processed: results.length,
      results,
    });
  } catch (error: any) {
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}