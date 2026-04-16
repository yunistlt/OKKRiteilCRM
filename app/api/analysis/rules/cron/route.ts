// @ts-nocheck
import { NextResponse } from 'next/server';
import { getRuleEngineFallbackHours } from '@/lib/rule-engine-execution';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

const DEFAULT_FALLBACK_HOURS = getRuleEngineFallbackHours();

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';

        // Default window is intentionally narrow: periodic fallback should reconcile recent drift,
        // while deep backfills stay explicit via start/end parameters or nightly reconciliation.
        const now = new Date();
        const lookback = new Date(now.getTime() - DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000);

        const start = searchParams.get('start') || lookback.toISOString();
        const end = searchParams.get('end') || now.toISOString();
        const targetRule = searchParams.get('rule');

        console.log(`[RuleEngine Cron] Starting analysis from ${start} to ${end}`);

        const result = await runRuleEngine(start, end, targetRule || undefined);

        return NextResponse.json({
            success: true,
            analyzed_window: { start, end },
            violations_found: result
        });

    } catch (e: any) {
        console.error('[RuleEngine Cron] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
