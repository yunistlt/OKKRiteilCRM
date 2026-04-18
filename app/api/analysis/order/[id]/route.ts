
// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { runInsightAnalysis } from '@/lib/insight-agent';
import { isRealtimePipelineEnabled } from '@/lib/realtime-pipeline';
import { enqueueOrderRefreshJob } from '@/lib/system-jobs';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'okk', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const orderId = parseInt(params.id);

    if (isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    try {
        console.log(`[Manual Analysis] Running for order ${orderId}...`);

        const realtimePipelineEnabled = await isRealtimePipelineEnabled();

        if (realtimePipelineEnabled) {
            await enqueueOrderRefreshJob({
                jobType: 'order_insight_refresh',
                orderId,
                source: 'manual_order_analysis_screen',
                priority: 10,
                windowSeconds: 1,
                payload: {
                    manual_triggered_at: new Date().toISOString(),
                },
            });

            const { data: metrics } = await supabase
                .from('order_metrics')
                .select('insights, computed_at')
                .eq('retailcrm_order_id', orderId)
                .maybeSingle();

            return NextResponse.json({
                success: true,
                orderId,
                mode: 'queued',
                insights: metrics?.insights || null,
                cachedAt: metrics?.computed_at || null,
                reason: 'Realtime pipeline owns deep order analysis. Targeted order_insight_refresh job queued.',
                timestamp: new Date().toISOString(),
            });
        }

        const insights = await runInsightAnalysis(orderId);

        if (!insights) {
            return NextResponse.json({
                success: false,
                message: 'Order not found or analysis failed'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            orderId: orderId,
            insights: insights,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[Manual Analysis] Trigger Failed:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
