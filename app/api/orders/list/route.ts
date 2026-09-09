import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { parseOrdersFilter, applyOrdersFilter, applyOverdueFilter } from '@/lib/orders-filter';

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

    // Нормативы читаем до запроса: по ним собирается условие просрочки.
    const { data: ownStatuses } = await supabase
        .from('crm_statuses')
        .select('external_code, norm_days')
        .not('external_code', 'is', null);
    const normByStatus = new Map<string, number | null>(
        ((ownStatuses || []) as any[]).map((s) => [s.external_code, s.norm_days])
    );
    const norms = ((ownStatuses || []) as any[])
        .filter((s) => typeof s.norm_days === 'number' && s.norm_days >= 0)
        .map((s) => ({ status: s.external_code as string, normDays: s.norm_days as number }));

    const base = () => {
        // Удалённые в CRM заказы в рабочем списке не показываем.
        let q = supabase.from('orders').select('*', { count: 'exact', head: false }).is('crm_deleted_at', null);
        q = applyOrdersFilter(q, filter);
        return filter.overdueOnly ? applyOverdueFilter(q, norms) : q;
    };

    const from = (page - 1) * pageSize;

    const [listResult, statusResult] = await Promise.all([
        base()
            .select('order_id, number, status, created_at, status_since, manager_id, totalsumm, raw_payload', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1),
        // Количества по статусам считаем без фильтра по статусу, иначе в колонке
        // останется только выбранный — навигация сломается.
        (() => {
            const q = applyOrdersFilter(
                supabase.from('orders').select('status').is('crm_deleted_at', null),
                { ...filter, statuses: [] }
            );
            return filter.overdueOnly ? applyOverdueFilter(q, norms) : q;
        })(),
    ]);

    if (listResult.error) {
        console.error('[orders/list] Не удалось прочитать заказы:', listResult.error);
        return NextResponse.json({ error: 'read_failed', details: listResult.error.message }, { status: 500 });
    }

    const rows = listResult.data || [];
    const managerIds = Array.from(new Set(rows.map((r: any) => r.manager_id).filter(Boolean)));

    const [{ data: managers }, { data: statusDict }, { data: statusColors }, { data: groupDict }, { data: cfDict }] = await Promise.all([
        managerIds.length
            ? supabase.from('managers').select('id, first_name, last_name').in('id', managerIds)
            : Promise.resolve({ data: [] as any[] }),
        supabase.from('retailcrm_dictionaries').select('item_code, item_name, group_code, ordering').eq('entity_type', 'status'),
        supabase.from('statuses').select('code, color, group_name'),
        supabase.from('retailcrm_dictionaries').select('item_code, item_name').eq('entity_type', 'statusGroup'),
        supabase.from('retailcrm_dictionaries').select('dictionary_code, item_code, item_name').eq('entity_type', 'customField').in('dictionary_code', ['typ_castomer', 'sfera_deiatelnosti']),
    ]);

    const managerNames = new Map<number, string>(
        ((managers || []) as any[]).map((m) => [Number(m.id), [m.last_name, m.first_name].filter(Boolean).join(' ')])
    );
    const statusNames = new Map<string, string>(
        ((statusDict || []) as any[]).map((s) => [s.item_code, s.item_name])
    );
    const cfNames = new Map<string, string>(
        ((cfDict || []) as any[]).map((d) => [`${d.dictionary_code}:${d.item_code}`, d.item_name])
    );
    const statusColorMap = new Map<string, string | null>(
        ((statusColors || []) as any[]).map((s) => [s.code, s.color || null])
    );

    // Дерево статусов с количествами для левой колонки.
    const counts = new Map<string, number>();
    for (const row of ((statusResult.data || []) as any[])) {
        if (!row.status) continue;
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }

    const groupNames = new Map<string, string>(((groupDict || []) as any[]).map((g) => [g.item_code, g.item_name]));
    const grouped = new Map<string, { groupName: string; statuses: Array<{ code: string; label: string; count: number; color: string | null; ordering: number }> }>();

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
            color: statusColorMap.get(st.item_code) || null,
            ordering: st.ordering ?? 999,
        });
    }

    const statusTree = Array.from(grouped.entries())
        .map(([groupCode, value]) => ({
            groupCode: groupCode === '__none__' ? null : groupCode,
            groupName: value.groupName,
            total: value.statuses.reduce((sum, s) => sum + s.count, 0),
            color: value.statuses.find((s) => s.color)?.color ?? null,
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
            statusColor: statusColorMap.get(row.status) || null,
            createdAt: row.created_at,
            managerName: managerNames.get(Number(row.manager_id)) || null,
            totalSumm: row.totalsumm != null ? Number(row.totalsumm) : null,
            customerName: payload.customer?.nickName || payload.customer?.name || [payload.firstName, payload.lastName].filter(Boolean).join(' ') || null,
            contragentName: payload.contragent?.legalName || null,
            managerComment: payload.managerComment || null,
            customerComment: payload.customerComment || null,
            categoryLabel: payload.customFields?.typ_castomer
                ? cfNames.get(`typ_castomer:${payload.customFields.typ_castomer}`) || null
                : null,
            sferaLabel: payload.customFields?.sfera_deiatelnosti
                ? cfNames.get(`sfera_deiatelnosti:${payload.customFields.sfera_deiatelnosti}`) || null
                : null,
            phone: payload.phone || row.phone || null,
            email: payload.email || null,
            nextContact: payload.customFields?.data_kontakta || null,
            ...statusAge(row, row.status_since ?? null, normByStatus.get(row.status) ?? null),
            // Состав показываем как в RetailCRM: название с артикулом, цена и количество.
            items: (Array.isArray(payload.items) ? payload.items : []).slice(0, 4).map((i: any) => ({
                name: i?.offer?.name || i?.productName || 'Позиция',
                article: i?.offer?.article || i?.offer?.xmlId || null,
                price: i?.initialPrice != null ? Number(i.initialPrice) : null,
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

/**
 * Сколько заказ сидит в текущем статусе и не выбился ли из норматива.
 * Если смены статуса в истории нет (старый заказ, синк не донёс) — считаем от создания
 * и помечаем оценку приблизительной, чтобы никого не обвинить по недостоверным данным.
 */
function statusAge(row: any, enteredAt: string | null, normDays: number | null) {
    const since = enteredAt || row.created_at || null;
    if (!since) return { daysInStatus: null, normDays, overdue: false, statusSinceApproximate: true };

    const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000));
    return {
        daysInStatus: days,
        statusSince: since,
        statusSinceApproximate: !enteredAt,
        normDays,
        overdue: normDays != null && days > normDays,
    };
}
