import { NextRequest, NextResponse } from 'next/server';
import {
  claimSystemJobs,
  completeSystemJob,
  failSystemJob,
  isSystemJobsPipelineEnabled,
} from '@/lib/system-jobs';
import { refreshManagerDialogueStats } from '@/lib/manager-aggregates';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const WORKER_KEY = 'system_jobs.manager_aggregate_refresh';

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
      workerId: `manager-aggregate-refresh:${Date.now()}`,
      jobTypes: ['manager_aggregate_refresh'],
      limit: 3,
      lockSeconds: 240,
    });

    if (!claimed.length) {
      return NextResponse.json({ ok: true, status: 'idle', processed: 0 });
    }

    const results: Array<Record<string, any>> = [];

    for (const job of claimed) {
      const payload = (job.payload || {}) as { manager_id?: number | string; source?: string };
      const rawManagerId = payload.manager_id;
      const managerId = rawManagerId ? Number(rawManagerId) : NaN;

      if (!Number.isFinite(managerId) || managerId <= 0) {
        await failSystemJob(job.id, 'Missing or invalid manager_id', 300);
        results.push({ job_id: job.id, status: 'failed_validation' });
        continue;
      }

      try {
        const aggregateResult = await refreshManagerDialogueStats(managerId);

        await completeSystemJob(job.id, {
          manager_id: managerId,
          source: payload.source || 'manager_aggregate_refresh',
          ...aggregateResult,
        });

        results.push({
          job_id: job.id,
          manager_id: managerId,
          source: payload.source || 'manager_aggregate_refresh',
          status: aggregateResult.status,
          matches_found: aggregateResult.matchesFound,
          calls_linked: aggregateResult.callsLinked,
        });
      } catch (error: any) {
        await failSystemJob(job.id, error.message || 'Unknown manager aggregate worker error', getRetryDelay(job.attempts || 0));
        results.push({
          job_id: job.id,
          manager_id: managerId,
          status: 'failed',
          error: error.message,
        });
      }
    }

    await recordWorkerSuccess(WORKER_KEY, { processed: results.length });
    return NextResponse.json({ ok: true, status: 'processed', processed: results.length, results });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown manager aggregate route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}