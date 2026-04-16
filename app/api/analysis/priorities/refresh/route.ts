// @ts-nocheck
import { NextResponse } from 'next/server';
import { refreshStoredPriorities } from '@/lib/prioritization';
import { executeRuleEngineWindow, isRealtimeRuleEngineEnabled } from '@/lib/rule-engine-execution';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for full refresh

export async function GET() {
    try {
        console.log('Refreshing priorities...');

        if (!isRealtimeRuleEngineEnabled()) {
            try {
                await executeRuleEngineWindow({ hours: 24 });
                console.log('Rule Engine verification complete.');
            } catch (reErr) {
                console.error('Rule Engine manual trigger failed:', reErr);
            }
        } else {
            console.log('Skipping broad Rule Engine refresh because realtime pipeline owns rules execution.');
        }

        // 1. Refresh Priorities
        const result = await refreshStoredPriorities(2000, true);

        if (result.count === 0) {
            return NextResponse.json({
                ok: true,
                message: 'No orders to update',
                rule_engine: isRealtimeRuleEngineEnabled() ? 'skipped_realtime_pipeline' : 'executed'
            });
        }

        return NextResponse.json({
            ok: true,
            count: result.count,
            deleted: result.deletedCount,
            message: 'Priorities refreshed',
            rule_engine: isRealtimeRuleEngineEnabled() ? 'skipped_realtime_pipeline' : 'executed'
        });
    } catch (e: any) {
        console.error('[Refresh Priorities] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
