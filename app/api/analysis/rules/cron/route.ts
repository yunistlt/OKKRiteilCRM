import { NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';

        // Default window: Look back 24 hours to catch any late-arriving data or missed events
        // Overlap is fine, as Rule Engine uses idempotency (upsert) for violations.
        const now = new Date();
        const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
