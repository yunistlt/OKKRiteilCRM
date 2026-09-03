import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { parseOrdersFilter, applyOrdersFilter } from '@/lib/orders-filter';

export const dynamic = 'force-dynamic';

/**
 * Список заказов для раздела «Заказы» — перенос экрана RetailCRM.
 *
 * Отдельный маршрут, а не ответвление от ОКК: там дашборд контроля качества со своими
 * оценками и критериями, здесь — рабочий список заказов. Смешивать их нельзя.
 */
export async function GET(req: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize') || '50', 10)));
    const filter = parseOrdersFilter(searchParams);

    // Менеджер видит только свои заказы — как в остальных разделах.
    if (session.user.role === 'manager' && session.user.retail_crm_manager_id) {
        filter.managers = [String(session.user.retail_crm_manager_id)];
    }

    const base = () => {
        // Удалённые в CRM заказы в рабочем списке не показываем.
        let q = supabase.from('orders').select('*', { count: 'exact', head: false }).is('crm_deleted_at', null);
        return applyOrdersFilter(q, filter);
    };

    const from = (page - 1) * pageSize;

    const [listResult, statusResult] = await Promise.all([
        base()
            .select('order_id, number, status, created_at, manager_id, totalsumm, raw_payload', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1),
        // Количества по статусам считаем без фильтра по статусу, иначе в колонке
        // останется только выбранный — навигация сломается.
        applyOrdersFilter(
            supabase.from('orders').select('status').is('crm_deleted_at', null),
            { ...filter, statuses: [] }
        ),
    ]);

    if (listResult.error) {
        console.error('[orders/list] Не удалось прочитать заказы:', listResult.error);
        return NextResponse.json({ error: 'read_failed', details: listResult.error.message }, { status: 500 });
    }

    const rows = listResult.data || [];
    const managerIds = Array.from(new Set(rows.map((r: any) => r.manager_id).filter(Boolean)));

    const [{ data: managers }, { data: statusDict }, { data: groupDict }] = await Promise.all([
        managerIds.length
            ? supabase.from('managers').select('id, first_name, last_name').in('id', managerIds)
            : Promise.resolve({ data: [] as any[] }),
        supabase.from('retailcrm_dictionaries').select('item_code, item_name, group_code, ordering').eq('entity_type', 'status'),
        supabase.from('retailcrm_dictionaries').select('item_code, item_name').eq('entity_type', 'statusGroup'),
    ]);

    const managerNames = new Map<number, string>(
        ((managers || []) as any[]).map((m) => [Number(m.id), [m.last_name, m.first_name].filter(Boolean).join(' ')])
    );
    const statusNames = new Map<string, string>(
        ((statusDict || []) as any[]).map((s) => [s.item_code, s.item_name])
    );

    // Дерево статусов с количествами для левой колонки.
    const counts = new Map<string, number>();
    for (const row of ((statusResult.data || []) as any[])) {
        if (!row.status) continue;
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }

    const groupNames = new Map<string, string>(((groupDict || []) as any[]).map((g) => [g.item_code, g.item_name]));
    const grouped = new Map<string, { groupName: string; statuses: Array<{ code: string; label: string; count: number; ordering: number }> }>();

    for (const st of ((statusDict || []) as any[])) {
        const count = counts.get(st.item_code) ?? 0;
        if (!count) continue;
        const key = st.group_code || '__none__';
        if (!grouped.has(key)) {
            grouped.set(key, {
                groupName: st.group_code ? (groupNames.get(st.group_code) || 'Прочее') : 'Без группы',
                statuses: [],
            });
        }
        grouped.get(key)!.statuses.push({
            code: st.item_code,
            label: st.item_name || st.item_code,
            count,
            ordering: st.ordering ?? 999,
        });
    }

    const statusTree = Array.from(grouped.entries())
        .map(([groupCode, value]) => ({
            groupCode: groupCode === '__none__' ? null : groupCode,
            groupName: value.groupName,
            total: value.statuses.reduce((sum, s) => sum + s.count, 0),
            statuses: value.statuses
                .sort((a, b) => a.ordering - b.ordering || a.label.localeCompare(b.label))
                .map(({ ordering, ...rest }) => rest),
        }))
        .sort((a, b) => b.total - a.total);

    const orders = rows.map((row: any) => {
        const payload = row.raw_payload ?? {};
        return {
            orderId: row.order_id,
            number: row.number ?? String(row.order_id),
            status: row.status,
            statusLabel: statusNames.get(row.status) || row.status,
            createdAt: row.created_at,
            managerName: managerNames.get(Number(row.manager_id)) || null,
            totalSumm: row.totalsumm != null ? Number(row.totalsumm) : null,
            customerName: payload.customer?.nickName || payload.customer?.name || [payload.firstName, payload.lastName].filter(Boolean).join(' ') || null,
            managerComment: payload.managerComment || null,
            nextContact: payload.customFields?.data_kontakta || null,
            items: (Array.isArray(payload.items) ? payload.items : []).slice(0, 4).map((i: any) => ({
                name: i?.offer?.name || i?.productName || 'Позиция',
                quantity: i?.quantity ?? null,
            })),
            itemsTotal: Array.isArray(payload.items) ? payload.items.length : 0,
        };
    });

    return NextResponse.json({
        ok: true,
        orders,
        statusTree,
        pagination: {
            page,
            pageSize,
            totalCount: listResult.count ?? 0,
            totalPages: Math.max(1, Math.ceil((listResult.count ?? 0) / pageSize)),
        },
    });
}
