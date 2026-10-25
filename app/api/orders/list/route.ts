import { NextResponse } from 'next/server';
import { byStatusCode, statusCodeOf, statusKeysOf } from '@/lib/own-crm/status-code';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { parseOrdersFilter, applyOrdersFilter, applyOverdueFilter, filterToCountParams } from '@/lib/orders-filter';
import { clientIdsByText } from '@/lib/orders-customer-search';

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

    /**
     * Поле «Покупатель» ищет и по карточке клиента — её номера подбираем до
     * запроса. Заказ может стоять на контактном лице, а клиент называться
     * иначе, и по названию клиента заказ раньше не находился (жалобы
     * менеджеров 06.10.2026).
     */
    if (filter.customer) {
        filter.customerIds = await clientIdsByText(filter.customer);
    }

    /**
     * Поиск по товару: слова ищет база и сразу расставляет по совпадению.
     *
     * Правило владельца 20.10.2026: «поиск по прямому вхождению знаков, без
     * учёта регистра и знаков препинания, сверху — с максимальным вхождением в
     * условия поиска». Повод — жалоба Ирины Гордеевой: «поиск не ищет по
     * обозначению, что стеллаж именно на 12 пар нужен, а он есть у нас».
     * Раньше слова искались строго подряд, и «12 пар стеллаж» не находило
     * «Сушильный стеллаж … На 12 пар обуви».
     *
     * Номера приходят уже в порядке совпадения — по нему и показываем строки,
     * пока человек не выбрал свой порядок сам.
     */
    let searchRank: Map<number, number> | null = null;
    if (filter.itemName.trim()) {
        const { data: ranked, error: rankError } = await supabase.rpc('orders_search_ranked', {
            q: filter.itemName.trim(),
            max_rows: 300,
        });
        if (rankError) {
            console.error('[orders/list] поиск не отработал:', rankError);
        } else {
            const rows = (ranked || []) as Array<{ order_id: number; rank: number }>;
            searchRank = new Map(rows.map((row) => [Number(row.order_id), Number(row.rank)]));
            filter.searchIds = rows.map((row) => Number(row.order_id));
        }
    }

    /**
     * Возможные дубли считает база: условие «у клиента есть второй незакрытый
     * заказ рядом по времени» одним запросом к таблице не выражается.
     */
    if (filter.duplicatesOnly) {
        const { data } = await supabase.rpc('orders_duplicate_ids', {});
        filter.duplicateIds = ((data || []) as any[])
            .map((row) => String(typeof row === 'object' ? Object.values(row)[0] : row));
    }

    /**
     * Порядок строк: по любой колонке, вверх или вниз (решение владельца
     * 05.10.2026). Сортируем только по настоящим колонкам таблицы — внутрь
     * `raw_payload` порядок не наводим: на 30 000 заказов это перебор всей
     * таблицы, запрос не укладывается в таймаут и список возвращается пустым.
     */
    const SORTABLE: Record<string, string> = {
        /**
         * «Номер» сортируем по `order_id`, а не по колонке `number`.
         *
         * Номер — ТЕКСТ, и сортировка по нему идёт по буквам: «10000» выше
         * «9999», а стрелка «новые сверху» поднимала наверх заказы десятилетней
         * давности (жалоба менеджера 08.10.2026). `order_id` — число и растёт
         * со временем, поэтому по убыванию сверху действительно свежие.
         *
         * Расхождение есть у 453 заказов из 30 207 — старая серия номеров вида
         * 1 00x xxx и номера с буквой на конце. Для них порядок «по номеру»
         * и так не определён, а главный запрос людей — «новые сверху».
         */
        number: 'order_id',
        status: 'status',
        createdAt: 'created_at',
        totalSumm: 'totalsumm',
        daysInStatus: 'status_since',
        manager: 'manager_id',
    };
    const sortKey = SORTABLE[String(searchParams.get('sort') ?? '')] ?? 'created_at';
    const sortAsc = searchParams.get('dir') === 'asc';
    /**
     * При поиске строки идут по совпадению — самое полное сверху, как просил
     * владелец. Выбрал человек свой порядок (нажал на заголовок колонки) —
     * слушаемся его.
     */
    const byRelevance = Boolean(searchRank) && !searchParams.get('sort');

    // Менеджер видит заказы всех менеджеров (решение владельца 02.10.2026): без общего
    // списка не распознать ни дубли, ни постоянных клиентов — это двойная работа.
    // Фильтр «Менеджеры» остаётся за пользователем и больше не перезаписывается.

    // Нормативы читаем до запроса: по ним собирается условие просрочки.
    // Оттуда же берём порядок показа — он утверждён на доске «Статусы и переходы».
    const { data: ownStatuses } = await supabase
        .from('crm_statuses')
        .select('code, external_code, name, norm_days, ordering, group_id, active');
    const normByStatus = byStatusCode((ownStatuses || []) as any[], (s) => s.norm_days as number | null);
    // Норматив проверяем по всем кодам статуса: старые заказы лежат с кодом RetailCRM.
    const norms = ((ownStatuses || []) as any[])
        .filter((s) => typeof s.norm_days === 'number' && s.norm_days >= 0)
        .flatMap((s) => statusKeysOf(s).map((status) => ({ status, normDays: s.norm_days as number })));

    const base = () => {
        // Удалённые в CRM заказы в рабочем списке не показываем.
        let q = supabase.from('orders').select('*', { count: 'exact', head: false }).is('crm_deleted_at', null);
        q = applyOrdersFilter(q, filter);
        return filter.overdueOnly ? applyOverdueFilter(q, norms) : q;
    };

    const from = (page - 1) * pageSize;

    const [listResult, statusResult, totalsResult] = await Promise.all([
        byRelevance
            // По совпадению порядок задаёт поиск, а не колонка таблицы: берём
            // всё найденное и режем страницу уже в этом порядке.
            // Триста строк: по поиску дальше никто не листает, а порядок по
            // совпадению ставит нужное в начало. Меньше строк — быстрее ответ,
            // у базы слабый диск.
            ? base().select('order_id, number, status, created_at, status_since, manager_id, totalsumm, raw_payload', { count: 'exact' })
                .range(0, 299)
            : base()
                .select('order_id, number, status, created_at, status_since, manager_id, totalsumm, raw_payload', { count: 'exact' })
                .order(sortKey, { ascending: sortAsc, nullsFirst: false })
                .range(from, from + pageSize - 1),
        // Количества по статусам считает база: выборкой их посчитать нельзя —
        // Supabase отдаёт максимум 1000 строк, и на 30 тысячах заказов целые
        // этапы пропадали из колонки. Фильтр по самому статусу не применяем,
        // иначе в колонке останется только выбранный и по ней не переключиться.
        supabase.rpc('orders_status_counts', { p: filterToCountParams({ ...filter, statuses: [] }, norms) }),
        // Итого по фильтру — тоже из базы: по странице его посчитать нельзя,
        // соврёт так же, как врали счётчики статусов.
        supabase.rpc('orders_filter_totals', { p: filterToCountParams(filter, norms) }),
    ]);

    if (listResult.error) {
        console.error('[orders/list] Не удалось прочитать заказы:', listResult.error);
        return NextResponse.json({
        error: 'read_failed', details: listResult.error.message }, { status: 500 });
    }

    const found = (listResult.data || []) as any[];
    // При поиске страницу режем сами: порядок задан совпадением.
    const rows = byRelevance && searchRank
        ? [...found]
            .sort((a, b) => (searchRank!.get(Number(b.order_id)) ?? 0) - (searchRank!.get(Number(a.order_id)) ?? 0)
                || Number(b.order_id) - Number(a.order_id))
            .slice(from, from + pageSize)
        : found;
    const managerIds = Array.from(new Set(rows.map((r: any) => r.manager_id).filter(Boolean)));

    const [
        { data: managers },
        { data: cfDict },
        { data: ownGroups },
    ] = await Promise.all([
        managerIds.length
            ? supabase.from('managers').select('id, first_name, last_name').in('id', managerIds)
            : Promise.resolve({ data: [] as any[] }),
        supabase.from('retailcrm_dictionaries').select('dictionary_code, item_code, item_name').eq('entity_type', 'customField').in('dictionary_code', ['typ_castomer', 'sfera_deiatelnosti']),
        // Порядок групп — наш, с доски «Статусы и переходы»: его утверждал
        // человек, а не RetailCRM. Связь по external_code.
        supabase.from('crm_status_groups').select('id, name, external_code, ordering, color, icon'),
    ]);

    const managerNames = new Map<number, string>(
        ((managers || []) as any[]).map((m) => [Number(m.id), [m.last_name, m.first_name].filter(Boolean).join(' ')])
    );
    /**
     * Названия статусов — с доски «Статусы и переходы», и только оттуда.
     *
     * Имя статуса лежало в двух таблицах сразу, и список читал не ту: статус,
     * заведённый на доске, показывался кодом — «dubl-zayavki» вместо «Дубль
     * заявки» (25.10.2026). Старые имена перенесены на доску миграцией
     * `20261025_statuses_single_source.sql`, второго справочника имён больше
     * нет.
     */
    const statusNames = new Map<string, string>();
    for (const own of ((ownStatuses || []) as any[])) {
        const name = String(own.name ?? '').trim();
        if (!name) continue;
        for (const key of statusKeysOf(own)) statusNames.set(key, name);
    }
    const cfNames = new Map<string, string>(
        ((cfDict || []) as any[]).map((d) => [`${d.dictionary_code}:${d.item_code}`, d.item_name])
    );
    // Цвет плашки статуса — цвет его этапа, как в RetailCRM: пастельные цвета
    // из таблицы statuses слишком бледные, и список выглядел выцветшим.
    const groupColorById = new Map<string, string | null>(
        ((ownGroups || []) as any[]).map((g) => [String(g.id), g.color || null]),
    );
    // Иконка этапа — её видит менеджер раньше, чем читает название статуса.
    const groupIconById = new Map<string, string | null>(
        ((ownGroups || []) as any[]).map((g) => [String(g.id), g.icon || null]),
    );
    const statusIconMap = byStatusCode(
        ((ownStatuses || []) as any[]).filter((s) => s.group_id),
        (s) => groupIconById.get(String(s.group_id)) ?? null,
    );
    // ЗАКОН: цвет статуса — цвет его этапа, других источников цвета нет.
    const statusColorMap = new Map<string, string | null>([
        ...Array.from(byStatusCode(
            ((ownStatuses || []) as any[]).filter((s) => s.group_id && groupColorById.get(String(s.group_id))),
            (s) => groupColorById.get(String(s.group_id))!,
        ).entries()),
    ]);

    // Дерево статусов с количествами для левой колонки.
    const counts = new Map<string, number>();
    for (const row of ((statusResult.data || []) as any[])) {
        if (!row.status) continue;
        counts.set(row.status, Number(row.orders_count ?? 0));
    }


    const statusOrderByCode = byStatusCode((ownStatuses || []) as any[], (s) => Number(s.ordering ?? 999));
    // ЗАКОН: состав и порядок левой колонки берём с доски «Статусы и переходы»
    // (`crm_status_groups` / `crm_statuses`), а не из групп RetailCRM. Статус,
    // переставленный человеком в другую группу, должен ехать туда же и здесь.
    const ownGroupById = new Map<string, { name: string; ordering: number; code: string | null }>(
        ((ownGroups || []) as any[]).map((g) => [
            String(g.id),
            { name: String(g.name || 'Без названия'), ordering: Number(g.ordering ?? 999), code: g.external_code ? String(g.external_code) : null },
        ]),
    );
    const ownGroupIdByStatus = byStatusCode(
        ((ownStatuses || []) as any[]).filter((s) => s.group_id),
        (s) => String(s.group_id),
    );

    type TreeStatus = { code: string; label: string; count: number; color: string | null; icon: string | null; ordering: number };
    const grouped = new Map<string, { groupName: string; groupCode: string | null; ordering: number; statuses: TreeStatus[] }>();

    const pushStatus = (key: string, group: { groupName: string; groupCode: string | null; ordering: number }, status: TreeStatus) => {
        if (!grouped.has(key)) grouped.set(key, { ...group, statuses: [] });
        grouped.get(key)!.statuses.push(status);
    };

    // ЗАКОН: в колонке всегда видны ВСЕ активные статусы с доски, в её порядке,
    // даже с нулём заказов. Менеджер должен видеть пустой этап, а не догадываться,
    // что он есть (требование владельца 01.10.2026).
    const shownCodes = new Set<string>();
    for (const own of ((ownStatuses || []) as any[])) {
        if (own.active === false) continue;
        const code = statusCodeOf(own);
        if (!code) continue;
        const group = own.group_id ? ownGroupById.get(String(own.group_id)) : undefined;
        if (!group) continue; // статус без группы на доске — показывать его негде

        for (const key of statusKeysOf(own)) shownCodes.add(key);
        pushStatus(
            String(own.group_id),
            { groupName: group.name, groupCode: group.code, ordering: group.ordering },
            {
                code,
                label: statusNames.get(code) || String(own.name || code),
                // Заказы могут лежать и под старым кодом RetailCRM — считаем по обоим.
                count: statusKeysOf(own).reduce((sum, key) => sum + (counts.get(key) ?? 0), 0),
                color: statusColorMap.get(code) || null,
                icon: statusIconMap.get(code) || null,
                ordering: Number(own.ordering ?? 999),
            },
        );
    }

    /**
     * Недействующий статус, в котором всё ещё лежат заказы: показываем
     * последним — иначе заказы пропадут из колонки. Это история: отменённые,
     * «Цех-успех», старые воронки.
     */
    for (const own of ((ownStatuses || []) as any[])) {
        const code = statusCodeOf(own);
        if (!code || shownCodes.has(code)) continue;
        const count = statusKeysOf(own).reduce((sum, key) => sum + (counts.get(key) ?? 0), 0);
        if (!count) continue;

        const historyGroup = own.group_id ? ownGroupById.get(String(own.group_id)) : undefined;
        pushStatus(
            historyGroup ? `old:${own.group_id}` : '__none__',
            {
                groupName: historyGroup ? `${historyGroup.name} (не используется)` : 'Без группы',
                groupCode: null,
                ordering: 9999,
            },
            {
                code,
                label: statusNames.get(code) || code,
                count,
                color: statusColorMap.get(code) || null,
                icon: statusIconMap.get(code) || null,
                ordering: Number(own.ordering ?? 9999),
            },
        );
    }

    const statusTree = Array.from(grouped.values())
        .map((value) => ({
            groupCode: value.groupCode,
            groupName: value.groupName,
            total: value.statuses.reduce((sum, s) => sum + s.count, 0),
            color: value.statuses.find((s) => s.color)?.color ?? null,
            icon: value.statuses.find((s) => s.icon)?.icon ?? null,
            ordering: value.ordering,
            statuses: value.statuses
                .sort((a, b) => a.ordering - b.ordering || a.label.localeCompare(b.label))
                .map(({ ordering, ...rest }) => rest),
        }))
        .sort((a, b) => a.ordering - b.ordering || a.groupName.localeCompare(b.groupName))
        .map(({ ordering, ...rest }) => rest);

    const orders = rows.map((row: any) => {
        const payload = row.raw_payload ?? {};
        return {
            orderId: row.order_id,
            number: row.number ?? String(row.order_id),
            status: row.status,
            statusLabel: statusNames.get(row.status) || row.status,
            statusColor: statusColorMap.get(row.status) || null,
            statusIcon: statusIconMap.get(row.status) || null,
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
            // Названия товаров и город поставки — по ним сверяют дубли.
            itemNames: (Array.isArray(payload.items) ? payload.items : [])
                .map((i: any) => i?.offer?.name || i?.productName)
                .filter(Boolean),
            // Сначала «Город доставки (менеджерам ОП)» — его менеджер и
            // заполняет; адрес доставки берём, только если поле пустое.
            deliveryCity: payload.customFields?.gorod_dostavki_menedzheram_op
                || payload.delivery?.address?.city
                || null,
            // Дополнительные поля заказа: из них собираются колонки и фильтры,
            // которые человек включает сам.
            customFields: payload.customFields ?? {},
        };
    });

    return NextResponse.json({
        ok: true,
        orders,
        // По каким колонкам список умеет сортировать — шапка таблицы рисует
        // стрелку только у них, чтобы не обещать того, чего нет.
        sortable: Object.keys(SORTABLE),
        statusTree,
        pagination: {
            page,
            pageSize,
            totalCount: listResult.count ?? 0,
            totalPages: Math.max(1, Math.ceil((listResult.count ?? 0) / pageSize)),
        },
        // Итого по всему фильтру, а не по странице.
        totals: {
            count: Number((totalsResult.data as any)?.[0]?.orders_count ?? listResult.count ?? 0),
            sum: Number((totalsResult.data as any)?.[0]?.total_sum ?? 0),
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
