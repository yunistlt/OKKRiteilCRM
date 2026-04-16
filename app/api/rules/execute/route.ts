
import { NextResponse } from 'next/server';
import { executeRuleEngineWindow, isRealtimeRuleEngineEnabled } from '@/lib/rule-engine-execution';

// Allow this to run for up to 60s (if Vercel Pro) or standard duration
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // Default: Check last 24 hours to be safe (idempotency ensures no duplicates)
    // Or user can pass ?hours=1
    const hours = parseInt(searchParams.get('hours') || '24');

    try {
        console.log(`[API] Triggering Rule Engine for last ${hours} hours...`);

        const result = await executeRuleEngineWindow({ hours });

        return NextResponse.json({
            success: true,
            mode: isRealtimeRuleEngineEnabled() ? 'realtime_safe_runner' : 'legacy_compatible_runner',
            message: `Rule Engine executed for last ${result.hours} hours`,
            analyzed_window: result.analyzed_window,
            violations_found: result.violations_found,
        });
    } catch (error: any) {
        console.error('[API] Rule Engine Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
