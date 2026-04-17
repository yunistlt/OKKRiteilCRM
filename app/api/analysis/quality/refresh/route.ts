// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { refreshControlledManagersDialogueStats, refreshManagerDialogueStats } from '@/lib/manager-aggregates';

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'okk', 'rop'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';
        const managerId = searchParams.get('managerId');
        const isRealtimePipelineEnabled = process.env.ENABLE_SYSTEM_JOBS_PIPELINE === 'true';

        if (isRealtimePipelineEnabled && !managerId && !force) {
            return NextResponse.json({
                success: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns manager aggregates. Use managerId for targeted refresh or force=true for emergency bulk fallback rebuild.',
            });
        }

        if (managerId) {
            console.log('[QualityRefresh] Starting targeted manager aggregate refresh...', { managerId });
            const result = await refreshManagerDialogueStats(managerId);

            return NextResponse.json({
                success: true,
                mode: 'single_manager',
                managerId,
                result,
                timestamp: new Date().toISOString(),
            });
        }

        console.log('[QualityRefresh] Starting controlled managers aggregate refresh...', { force });
        const results = await refreshControlledManagersDialogueStats();

        return NextResponse.json({
            success: true,
            mode: force ? 'bulk_force_fallback' : 'bulk',
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
