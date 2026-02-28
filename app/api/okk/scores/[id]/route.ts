import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const orderId = parseInt(params.id, 10);

    if (Number.isNaN(orderId)) {
        return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    try {
        const session = await getSession();
        const userRole = session?.user?.role || 'admin';
        const retailCrmId = session?.user?.retail_crm_manager_id
            ? Number(session.user.retail_crm_manager_id)
            : null;

        const [{ data: orderRow, error: orderError }, { data: scoreRow, error: scoreError }] = await Promise.all([
            supabase
                .from('orders')
                .select('order_id, status, manager_id, totalsumm')
                .eq('order_id', orderId)
                .maybeSingle(),
            supabase
                .from('okk_order_scores')
                .select('*')
                .eq('order_id', orderId)
                .maybeSingle()
        ]);

        if (orderError) throw orderError;
        if (scoreError) throw scoreError;

        if (!orderRow && !scoreRow) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const managerId = orderRow?.manager_id ?? scoreRow?.manager_id ?? null;
        if (userRole === 'manager' && retailCrmId && managerId && managerId !== retailCrmId) {
            return NextResponse.json({ error: 'Недостаточно прав для просмотра заказа' }, { status: 403 });
        }

        let managerName = scoreRow?.manager_name || null;
        if (!managerName && managerId) {
            const { data: managerData } = await supabase
                .from('managers')
                .select('first_name, last_name')
                .eq('id', managerId)
                .maybeSingle();

            if (managerData) {
                managerName = [managerData.first_name, managerData.last_name].filter(Boolean).join(' ') || null;
            }
        }

        let statusLabel = scoreRow?.status_label || orderRow?.status || null;
        let statusColor = scoreRow?.status_color || '#E5E7EB';
        if (orderRow?.status) {
            const { data: statusData } = await supabase
                .from('statuses')
                .select('name, color')
                .eq('code', orderRow.status)
                .maybeSingle();

            if (statusData) {
                statusLabel = statusData.name || statusLabel;
                statusColor = statusData.color || statusColor;
            }
        }

        const payload = {
            ...(scoreRow || {}),
            order_id: orderId,
            manager_id: managerId,
            manager_name: managerName || (managerId ? `#${managerId}` : '—'),
            status_label: statusLabel || '—',
            status_color: statusColor || '#E5E7EB',
            total_sum: orderRow?.totalsumm ?? scoreRow?.total_sum ?? null
        };

        return NextResponse.json({ order: payload });
    } catch (error: any) {
        console.error(`[OKK Score] ${orderId}:`, error);
        return NextResponse.json(
            { error: error.message || 'Не удалось загрузить оценку' },
            { status: 500 }
        );
    }
}
