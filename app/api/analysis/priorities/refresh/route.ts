// @ts-nocheck
import { NextResponse } from 'next/server';
import { refreshStoredPriorities } from '@/lib/prioritization';
import { runRuleEngine } from '@/lib/rule-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for full refresh

export async function GET() {
    try {
        console.log('Refreshing priorities & Running Rule Engine...');

        // 1. Run Rule Engine (Last 24h)
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        try {
            await runRuleEngine(yesterday.toISOString(), now.toISOString());
            console.log('Rule Engine verification complete.');
        } catch (reErr) {
            console.error('Rule Engine manual trigger failed:', reErr);
        }

        // 2. Refresh Priorities
        const result = await refreshStoredPriorities(2000, true);

        if (result.count === 0) {
            return NextResponse.json({ ok: true, message: 'No orders to update' });
        }

        return NextResponse.json({
            ok: true,
            count: result.count,
            deleted: result.deletedCount,
            message: 'Priorities refreshed'
        });
    } catch (e: any) {
        console.error('[Refresh Priorities] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
