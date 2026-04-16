import { NextRequest, NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WORKER_KEY = 'system_jobs.rule_engine';

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

function isRealtimePipelineEnabled() {
  return process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true';
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!isRealtimePipelineEnabled()) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const now = new Date();
    const hoursParam = req.nextUrl.searchParams.get('hours');
    const hours = Math.max(1, Number.parseInt(hoursParam || '24', 10) || 24);
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const violationsFound = await runRuleEngine(start.toISOString(), now.toISOString());

    await supabase.from('sync_state').upsert({
      key: 'rule_engine_last_run',
      value: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'key' });

    await recordWorkerSuccess(WORKER_KEY, {
      hours,
      violations_found: violationsFound,
    });

    return NextResponse.json({
      ok: true,
      status: 'completed',
      hours,
      violations_found: violationsFound,
      analyzed_window: {
        start: start.toISOString(),
        end: now.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message !== 'Unauthorized') {
      await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown rule engine worker error');
    }
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}