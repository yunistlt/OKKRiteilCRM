import { NextResponse } from 'next/server';
import { runInsightAnalysis } from '@/lib/insight-agent';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('orderId');

        if (orderId) {
            const results = await runInsightAnalysis(parseInt(orderId));
            return NextResponse.json({ ok: true, results });
        }

        // Default behavior: trigger for the latest 3 orders that don't have insights yet
        const { data: recentOrders } = await supabase
            .from('orders')
            .select('order_id')
            .order('created_at', { ascending: false })
            .limit(10);

        if (!recentOrders) return NextResponse.json({ ok: true, message: 'No orders' });

        const results = [];
        for (const order of recentOrders) {
            const res = await runInsightAnalysis(order.order_id);
            if (res) results.push(order.order_id);
        }

        return NextResponse.json({ ok: true, processed: results });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
