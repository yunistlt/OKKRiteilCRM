// @ts-nocheck
import { NextResponse } from 'next/server';
import { refreshControlledManagersDialogueStats } from '@/lib/manager-aggregates';

export async function POST() {
    try {
        console.log('[QualityRefresh] Starting controlled managers aggregate refresh...');
        const results = await refreshControlledManagersDialogueStats();

        return NextResponse.json({
            success: true,
            updatedManagers: results.length,
            matchesFound: results.reduce((sum, item) => sum + (item.matchesFound || 0), 0),
            callsLinked: results.reduce((sum, item) => sum + (item.callsLinked || 0), 0),
            timestamp: new Date().toISOString(),
            results,
        });

    } catch (e: any) {
        console.error('[QualityRefresh] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
