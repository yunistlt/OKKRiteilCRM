import { NextRequest, NextResponse } from 'next/server';
import { refreshControlledManagersDialogueStats } from '@/lib/manager-aggregates';
import { refreshStoredPriorities } from '@/lib/prioritization';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.nightly_reconciliation';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    const [aggregateResults, priorityResult] = await Promise.all([
      refreshControlledManagersDialogueStats(),
      refreshStoredPriorities(2000, true),
    ]);

    const result = {
      aggregates_updated: aggregateResults.length,
      aggregate_matches_found: aggregateResults.reduce((sum, item) => sum + (item.matchesFound || 0), 0),
      priorities_updated: priorityResult.count,
      priorities_deleted: priorityResult.deletedCount,
    };

    await recordWorkerSuccess(WORKER_KEY, result);

    return NextResponse.json({
      ok: true,
      status: 'completed',
      ...result,
    });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown nightly reconciliation error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}