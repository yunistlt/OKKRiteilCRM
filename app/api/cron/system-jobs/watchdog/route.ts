import { NextRequest, NextResponse } from 'next/server';
import { isSystemJobsPipelineEnabled, requeueExpiredSystemJobs } from '@/lib/system-jobs';

export const dynamic = 'force-dynamic';

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

    return NextResponse.json({ ok: true, requeued });
  } catch (error: any) {
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}