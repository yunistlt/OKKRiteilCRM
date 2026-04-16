import { NextRequest, NextResponse } from 'next/server';
import { isSystemJobsPipelineEnabled, requeueExpiredSystemJobs } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'system_jobs.watchdog';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isSystemJobsPipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const requeued = await requeueExpiredSystemJobs();
    await recordWorkerSuccess(WORKER_KEY, { requeued });

    return NextResponse.json({ ok: true, requeued });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown watchdog route error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}