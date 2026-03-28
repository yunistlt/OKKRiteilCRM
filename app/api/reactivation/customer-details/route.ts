import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customer_id');

    if (!customerId) {
        return NextResponse.json({ error: 'Missing customer_id' }, { status: 400 });
    }

    try {
        // 1. Fetch Client Profile (using external_id which is the CRM customer ID)
        const { data: client, error: clientErr } = await supabase
            .from('clients')
            .select('*')
            .eq('external_id', customerId)
            .single();

        if (clientErr && clientErr.code !== 'PGRST116') {
            throw clientErr;
        }

        // 2. Fetch All Orders
        const { data: orders, error: ordersErr } = await supabase
            .from('orders')
            .select('order_id, number, totalsumm, created_at, raw_payload')
            .eq('client_id', customerId)
            .order('created_at', { ascending: false });

        if (ordersErr) throw ordersErr;

        // 3. Fallback for stats if client record is zero/missing
        const calculatedLtv = orders?.reduce((sum, o) => sum + (Number(o.totalsumm) || 0), 0) || 0;
        const calculatedAvg = orders?.length ? calculatedLtv / orders.length : 0;

        const clientData = client ? {
            ...client,
            total_summ: Number(client.total_summ) || calculatedLtv,
            average_check: Number(client.average_check) || calculatedAvg,
            orders_count: client.orders_count || orders?.length || 0
        } : {
            total_summ: calculatedLtv,
            average_check: calculatedAvg,
            orders_count: orders?.length || 0
        };

        // 4. Extract Unique Products
        const productsMap = new Map<string, { count: number; lastPrice?: number }>();
        orders?.forEach(order => {
            const items = (order.raw_payload as any)?.items || [];
            items.forEach((item: any) => {
                const name = item.offer?.name || item.offer?.displayName || 'Неизвестный товар';
                const current = productsMap.get(name) || { count: 0 };
                productsMap.set(name, { 
                    count: current.count + (item.quantity || 1),
                    lastPrice: item.initialPrice || item.prices?.[0]?.price
                });
            });
        });

        const products = Array.from(productsMap.entries()).map(([name, stat]) => ({
            name,
            ...stat
        })).sort((a, b) => b.count - a.count);

        return NextResponse.json({
            success: true,
            client: clientData,
            orders: orders || [],
            products: products || []
        });

    } catch (error: any) {
        console.error('[customer-details]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
