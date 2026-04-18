import { NextResponse } from 'next/server';
import { runFullEvaluation } from '@/lib/okk-evaluator';
import { getSession } from '@/lib/auth';
import { canAccessTargetManager, getEffectiveCapabilityForRole } from '@/lib/access-control-server';
import { enqueueOrderRefreshJob } from '@/lib/system-jobs';
import { isRealtimePipelineEnabled } from '@/lib/realtime-pipeline';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function hasCronAuthorization(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// GET /api/okk/run-all — полный прогон всех контролируемых заказов
// Запускается: ночным cron + кнопкой в UI
export async function GET(request: Request) {
    try {
        const cronAuthorized = hasCronAuthorization(request);
        const session = cronAuthorized ? null : await getSession();
        const capability = cronAuthorized ? null : await getEffectiveCapabilityForRole(session?.user?.role);

        const { searchParams } = new URL(request.url);
        const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
        const specificOrderId = searchParams.get('orderId') ? parseInt(searchParams.get('orderId')!) : undefined;
        const force = searchParams.get('force') === 'true';
        const realtimePipelineEnabled = await isRealtimePipelineEnabled();

        if (realtimePipelineEnabled && !specificOrderId && !force) {
            return NextResponse.json({
                success: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production recalculation. Use force=true for emergency bulk fallback or orderId for single-order run.',
            });
        }

        if (!cronAuthorized && !capability?.canRunBulkOperations && !specificOrderId) {
            return NextResponse.json({ error: 'У вас нет прав на массовый запуск проверки' }, { status: 403 });
        }

        if (specificOrderId && !cronAuthorized) {
            const { data: order } = await supabase
                .from('orders')
                .select('manager_id')
                .eq('order_id', specificOrderId)
                .single();

            if (!order || !capability || !canAccessTargetManager(session?.user, capability, order.manager_id)) {
                return NextResponse.json({ error: 'У вас нет прав на перепроверку этого заказа' }, { status: 403 });
            }
        }

        if (!specificOrderId) {
            const nightlyUrl = new URL('/api/cron/system-jobs/nightly-reconciliation', request.url);
            nightlyUrl.searchParams.set('scope', 'priorities');
            if (force) {
                nightlyUrl.searchParams.set('force', 'true');
            }
            if (limit && Number.isFinite(limit) && limit > 0) {
                nightlyUrl.searchParams.set('limit', String(limit));
            }

            const headers: HeadersInit = {};
            if (process.env.CRON_SECRET) {
                headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
            }

            const fallbackResponse = await fetch(nightlyUrl.toString(), {
                method: 'GET',
                headers,
                cache: 'no-store',
            });

            const fallbackJson = await fallbackResponse.json().catch(() => ({}));
            if (!fallbackResponse.ok) {
                const message = typeof fallbackJson?.error === 'string'
                    ? fallbackJson.error
                    : 'Fallback queue seeding failed';
                throw new Error(message);
            }

            return NextResponse.json({
                success: true,
                mode: 'bulk_seeded',
                queue_scope: 'priorities',
                limit: limit || null,
                ...fallbackJson,
            });
        }

        if (realtimePipelineEnabled && specificOrderId && !force) {
            const manualTriggeredAt = new Date().toISOString();

            await enqueueOrderRefreshJob({
                jobType: 'order_score_refresh',
                orderId: specificOrderId,
                source: 'manual_run_all_single_order',
                priority: 10,
                windowSeconds: 1,
                payload: {
                    manual_triggered_at: manualTriggeredAt,
                    requested_via: 'api/okk/run-all',
                },
            });

            await enqueueOrderRefreshJob({
                jobType: 'order_insight_refresh',
                orderId: specificOrderId,
                source: 'manual_run_all_single_order',
                priority: 30,
                windowSeconds: 1,
                payload: {
                    manual_triggered_at: manualTriggeredAt,
                    requested_via: 'api/okk/run-all',
                },
            });

            return NextResponse.json({
                success: true,
                order_id: specificOrderId,
                mode: 'queued',
                next_jobs: ['order_score_refresh', 'order_insight_refresh'],
            });
        }

        console.log(`[ОКК Cron] Starting evaluation run... limit=${limit}, orderId=${specificOrderId}`);
        const result = await runFullEvaluation({ limit, specificOrderId });
        console.log(`[ОКК Cron] Done: ${result.processed} processed, ${result.errors} errors`);
        return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
        console.error('[ОКК Cron] Fatal error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
