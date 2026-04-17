import { NextResponse } from 'next/server';
import { evaluateOrder } from '@/lib/okk-evaluator';
import { getSession } from '@/lib/auth';
import { canAccessTargetManager, getEffectiveCapabilityForRole } from '@/lib/access-control-server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/okk/evaluate/:orderId — событийный триггер
export async function POST(
    request: Request,
    { params }: { params: { orderId: string } }
) {
    const orderId = parseInt(params.orderId);
    if (!orderId || isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 });
    }

    try {
        const session = await getSession();
        const capability = await getEffectiveCapabilityForRole(session?.user?.role);

        const { data: order } = await supabase
            .from('orders')
            .select('manager_id')
            .eq('order_id', orderId)
            .single();

        if (!order || !canAccessTargetManager(session?.user, capability, order.manager_id)) {
            return NextResponse.json({ error: 'У вас нет прав на перепроверку этого заказа' }, { status: 403 });
        }

        await evaluateOrder(orderId);
        return NextResponse.json({ success: true, order_id: orderId, mode: 'single_order' });
    } catch (e: any) {
        console.error('[ОКК API] Evaluate error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
