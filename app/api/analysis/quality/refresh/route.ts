// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { refreshManagerDialogueStats } from '@/lib/manager-aggregates';
import { isRealtimePipelineEnabled } from '@/lib/realtime-pipeline';

function buildCronHeaders() {
    if (!process.env.CRON_SECRET) {
        return undefined;
    }

    return {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
    };
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'okk', 'rop'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';
        const managerId = searchParams.get('managerId');
        const realtimePipelineEnabled = await isRealtimePipelineEnabled();

        if (realtimePipelineEnabled && !managerId && !force) {
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

        const targetUrl = new URL(`/api/cron/system-jobs/nightly-reconciliation?scope=aggregates${force ? '&force=true' : ''}`, request.url);
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: buildCronHeaders(),
            cache: 'no-store',
        });

        const payload = await response.json();
        return NextResponse.json({
            success: response.ok,
            mode: force ? 'bulk_force_fallback_seeded' : 'bulk_seeded',
            message: 'Manager aggregate bulk refresh was converted to chunked queue seeding.',
            queue_seed: payload,
            timestamp: new Date().toISOString(),
        }, { status: response.status });

    } catch (e: any) {
        console.error('[QualityRefresh] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
