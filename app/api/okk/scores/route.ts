// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { createSupabaseUserClient } from '@/utils/supabase-user';
import { getEffectiveCapabilityForRole } from '@/lib/access-control-server';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const userRole = session.user.role;
    const retailCrmId = session?.user?.retail_crm_manager_id;
    const capability = await getEffectiveCapabilityForRole(session.user.role);
    const readClient = session.accessToken ? createSupabaseUserClient(session.accessToken) || supabase : supabase;

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    let filterManager = searchParams.get('manager');
    const filterStatus = searchParams.get('status');

    // Насильно применяем фильтр для менеджера
    if (capability.dataScope === 'own' && retailCrmId) {
        filterManager = String(retailCrmId);
    }

    // 1. Получаем рабочие статусы
    const { data: settings } = await readClient
        .from('status_settings')
        .select('code')
        .eq('is_working', true);

    const workingStatuses = (settings || []).map(s => s.code);

    // 2. Базовый запрос к orders (все активные)
    let ordersQuery = readClient
        .from('orders')
        .select('order_id, status, created_at, manager_id, totalsumm, raw_payload', { count: 'exact' })
        .in('status', workingStatuses)
        .lt('order_id', 99900000); // Игнорируем тестовые

    if (from) ordersQuery = ordersQuery.gte('created_at', `${from}T00:00:00`);
    if (to) ordersQuery = ordersQuery.lte('created_at', `${to}T23:59:59`);
    if (filterStatus) {
        const statuses = filterStatus.split(',').filter(Boolean);
        if (statuses.length > 0) {
            ordersQuery = ordersQuery.in('status', statuses);
        }
    }

    if (filterManager) {
        const managerIds = filterManager.split(',').map(m => parseInt(m, 10)).filter(m => !isNaN(m));
        if (managerIds.length > 0) {
            ordersQuery = ordersQuery.in('manager_id', managerIds);
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
        const { data: scores } = await readClient
            .from('okk_order_scores')
            .select('*')
            .in('order_id', orderIds);

        scoresMap = Object.fromEntries((scores || []).map(s => [s.order_id, s]));
    }

    // 4. Загружаем имена менеджеров
    const managerIds = Array.from(new Set((activeOrders || []).map(o => o.manager_id).filter(Boolean)));
    let managerMap: Record<number, string> = {};
    if (managerIds.length > 0) {
        const { data: managers } = await readClient
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
        const { data: statuses } = await readClient
            .from('statuses')
            .select('code, name, color')
            .in('code', statusCodes);

        statusMap = Object.fromEntries((statuses || []).map(s => [s.code, { name: s.name, color: s.color }]));
    }

    // 6. Получаем реальные нарушения из okk_violations
    let violationsMap: Record<number, any[]> = {};
    if (orderIds.length > 0) {
        const { data: violationsData } = await readClient
            .from('okk_violations')
            .select('*')
            .in('order_id', orderIds)
            .order('detected_at', { ascending: false });

        if (violationsData) {
            violationsData.forEach(v => {
                if (!violationsMap[v.order_id]) violationsMap[v.order_id] = [];
                violationsMap[v.order_id].push({
                    description: v.details || 'Нарушение правила',
                    penalty_points: v.points || 0,
                    created_at: v.detected_at || v.violation_time || new Date().toISOString(),
                    status_from: null, // У нас нет этих данных в текущей схеме
                    status_to: null,
                    manager_name: managerMap[v.manager_id] || 'Менеджер'
                });
            });
        }
    }

    // 6b. Получаем данные о реактивации (Виктория)
    let reactivationMap: Record<number, any> = {};
    const customerIds = Array.from(new Set(
        (activeOrders || [])
            .map(o => (o.raw_payload as any)?.customer?.id)
            .filter(Boolean)
    )) as number[];

    if (customerIds.length > 0) {
        const { data: outreachData } = await readClient
            .from('ai_outreach_logs')
            .select('customer_id, status, sent_at, opened_at, replied_at, intent_status, generated_email, client_reply')
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false });

        if (outreachData) {
            outreachData.forEach(log => {
                // Берем только самую свежую запись для каждого клиента (т.к. мы уже отсортировали по created_at desc)
                if (!reactivationMap[log.customer_id]) {
                    reactivationMap[log.customer_id] = log;
                }
            });
        }
    }

    // 7. Calculate Global Averages
    let totalAvgScore = 0;
    let filteredAvgScore = 0;

    // A. Средний по всему ОП (игнорирует from, to, фильтр менеджера)
    const { data: allScores } = await readClient
        .from('okk_order_scores')
        .select('deal_score_pct')
        .not('deal_score_pct', 'is', null);

    if (allScores && allScores.length > 0) {
        totalAvgScore = Math.round(allScores.reduce((sum, s) => sum + (s.deal_score_pct || 0), 0) / allScores.length);
    }

    // B. Средний по текущим фильтрам (но без учета пагинации, то есть для ВСЕХ заказов под фильтрами)
    // First, get all order IDs matching the current FILTERS (ignoring page/pageSize)
    const { data: filteredOrdersAllPages } = await ordersQuery.select('order_id');
    const filteredOrderIds = (filteredOrdersAllPages || []).map(o => o.order_id);

    if (filteredOrderIds.length > 0) {
        const { data: filteredScoresData } = await readClient
            .from('okk_order_scores')
            .select('deal_score_pct')
            .in('order_id', filteredOrderIds)
            .not('deal_score_pct', 'is', null);

        if (filteredScoresData && filteredScoresData.length > 0) {
            filteredAvgScore = Math.round(filteredScoresData.reduce((sum, s) => sum + (s.deal_score_pct || 0), 0) / filteredScoresData.length);
        }
    }

    // 8. Обогащаем список заказов оценками и фильтруем по менеджеру если нужно
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
            violations: violationsMap[o.order_id] || [],
            reactivation: reactivationMap[(o.raw_payload as any)?.customer?.id] || null
        };
    });

    return NextResponse.json({
        scores: enriched,
        averages: {
            totalAvgScore,
            filteredAvgScore
        },
        pagination: {
            totalCount: totalCount || 0,
            page,
            pageSize,
            totalPages: Math.ceil((totalCount || 0) / pageSize)
        }
    });
}
