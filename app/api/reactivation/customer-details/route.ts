// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

export async function GET(req: Request) {
    const session = await getSession();
    if (!hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customer_id');

    if (!customerId) {
        return NextResponse.json({ error: 'Missing customer_id' }, { status: 400 });
    }

    try {
        // 1. Fetch Client Profile (using id which is the primary CRM ID)
        const { data: client, error: clientErr } = await supabase
            .from('clients')
            .select('*')
            .eq('id', customerId)
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

        // 4. Advanced Analytics
        let lastOrderDate = null;
        let daysSinceLastOrder = null;
        let ordersPerYear = 0;
        let avgIntervalDays = null;

        if (orders && orders.length > 0) {
            const sortedOrders = [...orders].sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            
            const firstDate = new Date(sortedOrders[0].created_at);
            const lastDate = new Date(sortedOrders[sortedOrders.length - 1].created_at);
            lastOrderDate = lastDate.toISOString();
            
            const now = new Date();
            daysSinceLastOrder = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            
            const diffMs = lastDate.getTime() - firstDate.getTime();
            const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            
            if (diffYears > 0.01) {
                ordersPerYear = Number((orders.length / diffYears).toFixed(1));
            } else {
                ordersPerYear = orders.length; // If all orders in a short span, just count them
            }

            if (orders.length > 1) {
                avgIntervalDays = Math.floor(diffDays / (orders.length - 1));
            }
        }

        const products = Array.from(productsMap.entries()).map(([name, stat]) => ({
            name,
            ...stat
        })).sort((a, b) => b.count - a.count);

        // 5. Force stats recalculation across all updated clients
        const { error: rpcError } = await supabase.rpc('recalculate_all_client_stats');
        if (rpcError) console.error('Recalculation RPC Error:', rpcError);

        return NextResponse.json({
            success: true,
            client: clientData,
            orders: orders || [],
            products: products || [],
            analytics: {
                lastOrderDate,
                daysSinceLastOrder,
                ordersPerYear,
                avgIntervalDays
            }
        });

    } catch (error: any) {
        console.error('[customer-details]', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
