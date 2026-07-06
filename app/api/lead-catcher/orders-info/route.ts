import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { orderIds } = body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ orders: {} });
        }

        const [ordersRes, managersRes, statusesRes] = await Promise.all([
            supabase
                .from('orders')
                .select('order_id, status, totalsumm, raw_payload, manager_id')
                .in('order_id', orderIds),
            supabase
                .from('managers')
                .select('id, first_name, last_name'),
            supabase
                .from('statuses')
                .select('code, name, color')
        ]);

        const ordersList = ordersRes.data || [];
        const managersList = managersRes.data || [];
        const statusesList = statusesRes.data || [];

        const managersMap = new Map<number, string>(managersList.map((m: any) => [m.id, `${m.first_name || ''} ${m.last_name || ''}`.trim()]));
        const statusesMap = new Map<string, { name: string | null; color: string | null }>(
            statusesList.map((s: any) => [s.code, { name: s.name, color: s.color }])
        );

        const mappedOrders: Record<number, any> = {};

        ordersList.forEach((o: any) => {
            const rawPayload = o.raw_payload || {};
            const customer = rawPayload?.customer || {};
            const nameParts = [
                customer?.lastName || rawPayload?.lastName || '',
                customer?.firstName || rawPayload?.firstName || '',
                customer?.patronymic || rawPayload?.patronymic || ''
            ].filter(Boolean);
            let customerName = nameParts.join(' ').trim();
            if (!customerName) {
                const contragent = rawPayload?.contragent || {};
                customerName = contragent?.companyName || contragent?.contragentName || '';
            }

            const statusInfo = statusesMap.get(o.status) || { name: o.status || null, color: null };
            const managerName = managersMap.get(o.manager_id) || (rawPayload?.manager ? `${rawPayload.manager.firstName || ''} ${rawPayload.manager.lastName || ''}`.trim() : null);

            mappedOrders[o.order_id] = {
                order_id: o.order_id,
                statusName: statusInfo.name,
                statusColor: statusInfo.color,
                amount: o.totalsumm,
                managerName: managerName || '—',
                customerName: customerName || null
            };
        });

        return NextResponse.json({ orders: mappedOrders });
    } catch (err: any) {
        console.error('Error fetching orders info:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
