
import { NextResponse } from 'next/server';
import { runRuleEngine } from '@/lib/rule-engine';

// Allow this to run for up to 60s (if Vercel Pro) or standard duration
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // Default: Check last 24 hours to be safe (idempotency ensures no duplicates)
    // Or user can pass ?hours=1
    const hours = parseInt(searchParams.get('hours') || '24');

    const now = new Date();
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

    try {
        console.log(`[API] Triggering Rule Engine for last ${hours} hours...`);

        await runRuleEngine(start.toISOString(), now.toISOString());

        return NextResponse.json({
            success: true,
            message: `Rule Engine executed for range ${start.toISOString()} -> ${now.toISOString()}`
        });
    } catch (error: any) {
        console.error('[API] Rule Engine Failed:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
