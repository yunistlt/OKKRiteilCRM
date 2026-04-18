// @ts-nocheck
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { runInsightAnalysis } from '@/lib/insight-agent';
import { isRealtimePipelineEnabled } from '@/lib/realtime-pipeline';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
const WORKER_KEY = 'fallback.insight_agent';

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'okk', 'rop'])) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('orderId');
        const force = searchParams.get('force') === 'true';
        const realtimePipelineEnabled = await isRealtimePipelineEnabled();

        if (orderId) {
            const results = await runInsightAnalysis(parseInt(orderId));
            await recordWorkerSuccess(WORKER_KEY, { status: 'targeted_completed', order_id: parseInt(orderId) });
            return NextResponse.json({ ok: true, results });
        }

        if (realtimePipelineEnabled && !force) {
            await recordWorkerSuccess(WORKER_KEY, { status: 'skipped', reason: 'realtime_owned' });
            return NextResponse.json({
                ok: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production insight refresh. Use orderId for targeted refresh or force=true for emergency fallback run.',
            });
        }

        // Default behavior: trigger for the latest 3 orders that don't have insights yet
        const { data: recentOrders } = await supabase
            .from('orders')
            .select('order_id')
            .order('created_at', { ascending: false })
            .limit(10);

        if (!recentOrders) {
            await recordWorkerSuccess(WORKER_KEY, { status: 'idle', processed: 0, reason: 'no_orders' });
            return NextResponse.json({ ok: true, message: 'No orders' });
        }

        const results = [];
        for (const order of recentOrders) {
            const res = await runInsightAnalysis(order.order_id);
            if (res) results.push(order.order_id);
        }

        await recordWorkerSuccess(WORKER_KEY, {
            status: 'completed',
            processed: results.length,
        });

        return NextResponse.json({ ok: true, processed: results });

    } catch (e: any) {
        await recordWorkerFailure(WORKER_KEY, e.message || 'Unknown insight fallback error');
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
