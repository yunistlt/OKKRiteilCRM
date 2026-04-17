// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { refreshStoredPriorities, refreshStoredPriorityForOrder } from '@/lib/prioritization';
import { executeRuleEngineWindow, isRealtimeRuleEngineEnabled } from '@/lib/rule-engine-execution';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for full refresh

function hasCronAuthorization(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: Request) {
    try {
        const cronAuthorized = hasCronAuthorization(request);
        const session = cronAuthorized ? null : await getSession();
        if (!cronAuthorized && !hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const force = searchParams.get('force') === 'true';
        const specificOrderId = searchParams.get('orderId') ? Number(searchParams.get('orderId')) : null;
        const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 2000;

        console.log('Refreshing priorities...', { force, specificOrderId, limit });

        if (isRealtimeRuleEngineEnabled() && !specificOrderId && !force) {
            return NextResponse.json({
                ok: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production priority refresh. Use orderId for targeted refresh or force=true for emergency bulk fallback.',
                rule_engine: 'skipped_realtime_pipeline',
            });
        }

        if (!isRealtimeRuleEngineEnabled()) {
            try {
                await executeRuleEngineWindow({ hours: 24 });
                console.log('Rule Engine verification complete.');
            } catch (reErr) {
                console.error('Rule Engine manual trigger failed:', reErr);
            }
        } else if (force) {
            console.log('Realtime pipeline enabled: skipping broad Rule Engine pass, running emergency bulk priorities only.');
        } else {
            console.log('Skipping broad Rule Engine refresh because realtime pipeline owns rules execution.');
        }

        if (specificOrderId) {
            const result = await refreshStoredPriorityForOrder(specificOrderId, true);

            return NextResponse.json({
                ok: true,
                mode: 'single_order',
                orderId: specificOrderId,
                result,
                message: `Priority refreshed for order ${specificOrderId}`,
                rule_engine: isRealtimeRuleEngineEnabled() ? 'skipped_realtime_pipeline' : 'executed',
            });
        }

        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 2000;
        const result = await refreshStoredPriorities(safeLimit, true);

        if (result.count === 0) {
            return NextResponse.json({
                ok: true,
                mode: force ? 'bulk_force_fallback' : 'bulk',
                message: 'No orders to update',
                rule_engine: isRealtimeRuleEngineEnabled() ? 'skipped_realtime_pipeline' : 'executed'
            });
        }

        return NextResponse.json({
            ok: true,
            mode: force ? 'bulk_force_fallback' : 'bulk',
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
