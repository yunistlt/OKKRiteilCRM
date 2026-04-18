// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { refreshStoredPriorityForOrder } from '@/lib/prioritization';
import { enqueueOrderRefreshJob } from '@/lib/system-jobs';
import { isRealtimePipelineEnabled } from '@/lib/realtime-pipeline';
import { isRealtimeRuleEngineEnabled } from '@/lib/rule-engine-execution';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for full refresh

function hasCronAuthorization(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

function buildCronHeaders() {
    if (!process.env.CRON_SECRET) {
        return undefined;
    }

    return {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
    };
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
        const realtimeRuleEngineEnabled = await isRealtimeRuleEngineEnabled();

        console.log('Refreshing priorities...', { force, specificOrderId, limit });

        if (realtimeRuleEngineEnabled && !specificOrderId && !force) {
            return NextResponse.json({
                ok: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production priority refresh. Use orderId for targeted refresh or force=true for emergency bulk fallback.',
                rule_engine: 'skipped_realtime_pipeline',
            });
        }

        if (realtimeRuleEngineEnabled && force) {
            console.log('Realtime pipeline enabled: skipping broad Rule Engine pass, running emergency bulk priorities only.');
        }

        if (specificOrderId) {
            const realtimePipelineEnabled = await isRealtimePipelineEnabled();

            if (realtimePipelineEnabled && !force) {
                const manualTriggeredAt = new Date().toISOString();

                await enqueueOrderRefreshJob({
                    jobType: 'order_score_refresh',
                    orderId: specificOrderId,
                    source: 'manual_priority_refresh',
                    priority: 10,
                    windowSeconds: 1,
                    payload: {
                        manual_triggered_at: manualTriggeredAt,
                        requested_via: 'api/analysis/priorities/refresh',
                    },
                });

                const { data: cachedPriority } = await supabase
                    .from('order_priorities')
                    .select('level, score, reasons, summary, recommended_action, updated_at')
                    .eq('order_id', specificOrderId)
                    .maybeSingle();

                return NextResponse.json({
                    ok: true,
                    mode: 'queued',
                    orderId: specificOrderId,
                    result: cachedPriority || null,
                    cached_at: cachedPriority?.updated_at || null,
                    message: cachedPriority
                        ? `Priority refresh for order ${specificOrderId} was queued. Returning last stored priority until order_score_refresh completes.`
                        : `Priority refresh for order ${specificOrderId} was queued. Fresh priority will appear after order_score_refresh completes.`,
                    rule_engine: 'delegated_to_score_refresh_job',
                    next_jobs: ['order_score_refresh'],
                });
            }

            const result = await refreshStoredPriorityForOrder(specificOrderId, true);

            return NextResponse.json({
                ok: true,
                mode: 'single_order',
                orderId: specificOrderId,
                result,
                message: `Priority refreshed for order ${specificOrderId}`,
                rule_engine: realtimeRuleEngineEnabled ? 'skipped_realtime_pipeline' : 'executed',
            });
        }

        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 2000;
        const scopeQuery = `/api/cron/system-jobs/nightly-reconciliation?scope=priorities${force ? '&force=true' : ''}`;
        const targetUrl = new URL(scopeQuery, request.url);
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: buildCronHeaders(),
                cache: 'no-store',
            });

            const payload = await response.json();
            return NextResponse.json({
                ok: response.ok,
                mode: force ? 'bulk_force_fallback_seeded' : 'bulk_seeded',
                limit: safeLimit,
                message: 'Priority bulk refresh was converted to chunked queue seeding.',
                rule_engine: 'delegated_to_score_refresh_jobs',
                queue_seed: payload,
            }, { status: response.status });
    } catch (e: any) {
        console.error('[Refresh Priorities] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
