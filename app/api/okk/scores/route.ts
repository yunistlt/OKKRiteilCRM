import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const filterManager = searchParams.get('manager');
    const filterStatus = searchParams.get('status');

    // 1. Получаем рабочие статусы
    const { data: settings } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);

    const workingStatuses = (settings || []).map(s => s.code);

    // 2. Базовый запрос к orders (все активные)
    let ordersQuery = supabase
        .from('orders')
        .select('order_id, status, created_at, manager_id, totalsumm', { count: 'exact' })
        .in('status', workingStatuses)
        .lt('order_id', 99900000); // Игнорируем тестовые

    if (from) ordersQuery = ordersQuery.gte('created_at', `${from}T00:00:00`);
    if (to) ordersQuery = ordersQuery.lte('created_at', `${to}T23:59:59`);
    if (filterStatus) ordersQuery = ordersQuery.eq('status', filterStatus);

    // Exact match for manager ID now that frontend uses a select dropdown
    if (filterManager) {
        const managerId = parseInt(filterManager, 10);
        if (!isNaN(managerId)) {
            ordersQuery = ordersQuery.eq('manager_id', managerId);
        }
    }

    // Пагинация
    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    const { data: activeOrders, error: ordersError, count: totalCount } = await ordersQuery
        .order('created_at', { ascending: false })
        .range(fromIdx, toIdx);

    if (ordersError) {
        return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    // 3. Получаем оценки для этих заказов
    const orderIds = (activeOrders || []).map(o => o.order_id);
    let scoresMap: Record<number, any> = {};
    if (orderIds.length > 0) {
        const { data: scores } = await supabase
            .from('okk_order_scores')
            .select('*')
            .in('order_id', orderIds);

        scoresMap = Object.fromEntries((scores || []).map(s => [s.order_id, s]));
    }

    // 4. Загружаем имена менеджеров
    const managerIds = Array.from(new Set((activeOrders || []).map(o => o.manager_id).filter(Boolean)));
    let managerMap: Record<number, string> = {};
    if (managerIds.length > 0) {
        const { data: managers } = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .in('id', managerIds);

        managerMap = Object.fromEntries(
            (managers || []).map(m => [
                m.id,
                [m.first_name, m.last_name].filter(Boolean).join(' ')
            ])
        );
    }

    // 5. Загружаем статусы
    const statusCodes = Array.from(new Set((activeOrders || []).map(o => o.status).filter(Boolean)));
    let statusMap: Record<string, { name: string; color: string | null }> = {};
    if (statusCodes.length > 0) {
        const { data: statuses } = await supabase
            .from('statuses')
            .select('code, name, color')
            .in('code', statusCodes);

        statusMap = Object.fromEntries((statuses || []).map(s => [s.code, { name: s.name, color: s.color }]));
    }

    // 6. Обогащаем список заказов оценками и фильтруем по менеджеру если нужно
    let enriched = (activeOrders || []).map(o => {
        const score = scoresMap[o.order_id] || {};
        return {
            ...score,
            order_id: o.order_id,
            order_status: o.status,
            manager_id: o.manager_id,
            eval_date: score.eval_date || null,
            manager_name: o.manager_id ? (managerMap[o.manager_id] || `#${o.manager_id}`) : '—',
            status_label: o.status ? (statusMap[o.status]?.name || o.status) : '—',
            status_color: o.status ? (statusMap[o.status]?.color || '#E5E7EB') : '#E5E7EB',
            total_sum: o.totalsumm || 0,
        };
    });

    return NextResponse.json({
        scores: enriched,
        pagination: {
            totalCount: totalCount || 0,
            page,
            pageSize,
            totalPages: Math.ceil((totalCount || 0) / pageSize)
        }
    });
}
