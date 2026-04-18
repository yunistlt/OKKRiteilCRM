import { NextRequest, NextResponse } from 'next/server';
import {
  executeRuleEngineWindow,
  getRuleEngineFallbackHours,
  isRealtimeRuleEngineEnabled,
} from '@/lib/rule-engine-execution';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_FALLBACK_HOURS = getRuleEngineFallbackHours();

function ensureAuthorized(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    throw new Error('Unauthorized');
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAuthorized(req);

    if (!(await isRealtimeRuleEngineEnabled())) {
      return NextResponse.json({ ok: true, status: 'disabled' });
    }

    const hoursParam = req.nextUrl.searchParams.get('hours');
    const hours = Math.max(1, Number.parseInt(hoursParam || '', 10) || DEFAULT_FALLBACK_HOURS);
    return NextResponse.json(await executeRuleEngineWindow({ hours }));
  } catch (error: any) {
    const isUnauthorized = error.message === 'Unauthorized';
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}