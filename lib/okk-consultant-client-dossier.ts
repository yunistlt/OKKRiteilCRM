/**
 * Досье клиента для Семёна: кто это, чей, сколько покупал, что заказывал.
 *
 * Инструмент `order_dossier` отвечает только когда известен номер заказа.
 * Вопрос менеджера чаще другой: «что за клиент ООО „Ромашка“», «сколько они
 * у нас покупали», «чей это клиент» (решение владельца 02.11.2026 — Семён
 * отвечает и по клиентам тоже).
 *
 * Берём из нашей базы: карточка клиента, группа компаний (она сильнее
 * склейки по ИНН) и последние заказы. Оплаченной покупкой считаем то же, что
 * считает зарплата, — заказ с пришедшими деньгами, иначе два места в системе
 * ответят на один вопрос по-разному.
 */
import { supabase } from '@/utils/supabase';
import { formatRub } from '@/lib/format';

/** Сколько карточек отдаём на нечёткий запрос: список для выбора, а не простыня. */
const MAX_CARDS = 5;
/** Последние заказы карточки — чтобы разговор опирался на свежее. */
const MAX_ORDERS = 8;

export const CLIENT_DOSSIER_TOOL = {
    type: 'function' as const,
    function: {
        name: 'client_dossier',
        description:
            'Досье клиента: карточка (название, ИНН, телефоны, почта), ответственный менеджер, группа компаний, сколько заказов и сколько из них оплачено, последние заказы с суммами и статусами. Вызывай на вопросы «что за клиент», «чей это клиент», «сколько он у нас покупал», «есть ли у него другие юрлица». Ищет по названию, ИНН или номеру карточки.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Название компании, ИНН или номер карточки клиента' },
            },
            required: ['query'],
        },
    },
} as const;

export const CLIENT_DOSSIER_TOOL_NAME = 'client_dossier';

type ClientRow = {
    id: number | string;
    company_name: string | null;
    contact_name: string | null;
    inn: string | null;
    phones: any;
    email: string | null;
    manager_id: number | string | null;
    orders_count: number | null;
    merged_into: number | string | null;
};

/** Телефоны лежат то списком объектов, то строкой — приводим к строкам. */
function phoneList(raw: any): string[] {
    if (!raw) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items
        .map((item) => (typeof item === 'string' ? item : item?.number ?? item?.phone ?? null))
        .filter((x): x is string => Boolean(x))
        .slice(0, 3);
}

async function findCards(query: string): Promise<ClientRow[]> {
    const text = query.trim();
    if (!text) return [];
    const fields = 'id, company_name, contact_name, inn, phones, email, manager_id, orders_count, merged_into';

    // Номер карточки или ИНН — точное попадание, без перебора по названию.
    const digits = text.replace(/\D/g, '');
    if (digits && digits === text.replace(/\s/g, '')) {
        const column = digits.length >= 10 ? 'inn' : 'id';
        const { data } = await supabase.from('clients').select(fields).eq(column, digits).limit(MAX_CARDS);
        if ((data ?? []).length > 0) return data as ClientRow[];
    }

    const { data } = await supabase
        .from('clients')
        .select(fields)
        .or(`company_name.ilike.%${text}%,contact_name.ilike.%${text}%`)
        .order('orders_count', { ascending: false, nullsFirst: false })
        .limit(MAX_CARDS);

    return (data ?? []) as ClientRow[];
}

async function cardDossier(card: ClientRow): Promise<any> {
    const clientId = Number(card.id);

    const [{ data: orders }, { data: member }, managerCard, { count: ordersTotal }] = await Promise.all([
        supabase
            .from('orders')
            .select('id, number, status, totalsumm, created_at, manager_id')
            .eq('customer_id', clientId)
            .is('crm_deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(MAX_ORDERS),
        supabase.from('company_group_members').select('group_id').eq('client_id', clientId).maybeSingle(),
        card.manager_id
            ? supabase.from('managers').select('first_name, last_name').eq('id', card.manager_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
        // Счётчик в карточке приходит из выгрузки и у своих заказов остаётся
        // нулём — считаем по факту, иначе Семён скажет «заказов нет» при двух.
        supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', clientId)
            .is('crm_deleted_at', null),
    ]);

    let group: { name: string; cards: number } | null = null;
    if ((member as any)?.group_id) {
        const [{ data: groupRow }, { count }] = await Promise.all([
            supabase.from('company_groups').select('name').eq('id', (member as any).group_id).maybeSingle(),
            supabase
                .from('company_group_members')
                .select('client_id', { count: 'exact', head: true })
                .eq('group_id', (member as any).group_id),
        ]);
        if (groupRow) group = { name: (groupRow as any).name, cards: count ?? 0 };
    }

    // «Чей клиент» — вопрос из тех, что задают чаще всего. В карточке владелец
    // проставлен не всегда, поэтому запасной ответ — менеджер последнего заказа.
    let manager = managerCard?.data
        ? [(managerCard as any).data.first_name, (managerCard as any).data.last_name].filter(Boolean).join(' ')
        : null;
    let managerSource: string | null = manager ? 'карточка клиента' : null;
    const lastManagerId = ((orders ?? []) as any[]).find((o) => o.manager_id)?.manager_id ?? null;
    if (!manager && lastManagerId) {
        const { data: byOrder } = await supabase
            .from('managers')
            .select('first_name, last_name')
            .eq('id', lastManagerId)
            .maybeSingle();
        if (byOrder) {
            manager = [(byOrder as any).first_name, (byOrder as any).last_name].filter(Boolean).join(' ') || null;
            managerSource = manager ? 'по последнему заказу' : null;
        }
    }

    // Статусы называем по-человечески: код из базы человеку ничего не говорит.
    const statusCodes = Array.from(new Set(((orders ?? []) as any[]).map((o) => o.status).filter(Boolean)));
    const statusNames = new Map<string, string>();
    if (statusCodes.length > 0) {
        const { data: statuses } = await supabase.from('crm_statuses').select('code, name').in('code', statusCodes);
        for (const row of (statuses ?? []) as any[]) statusNames.set(String(row.code), String(row.name));
    }

    // Оплаченные заказы — те же, что считает зарплата: с пришедшими деньгами.
    const orderIds = ((orders ?? []) as any[]).map((o) => o.id);
    const paidIds = new Set<number>();
    if (orderIds.length > 0) {
        const { data: payments } = await supabase
            .from('order_payments')
            .select('order_id')
            .in('order_id', orderIds)
            .in('status', ['paid', 'check-off-full'])
            .gt('amount', 0);
        for (const row of (payments ?? []) as any[]) paidIds.add(Number(row.order_id));
    }

    return {
        clientId,
        name: card.company_name || card.contact_name || null,
        inn: card.inn || null,
        phones: phoneList(card.phones),
        email: card.email || null,
        manager,
        managerSource,
        mergedInto: card.merged_into ? Number(card.merged_into) : null,
        group,
        ordersTotal: ordersTotal ?? (orders ?? []).length,
        lastOrders: ((orders ?? []) as any[]).map((o) => ({
            number: o.number,
            status: statusNames.get(String(o.status)) ?? o.status,
            amount: o.totalsumm,
            // Готовая строка с разрядами: модель перескажет её как есть, а
            // «835751.05» человеку читать нельзя (ЗАКОН о разделителях).
            amountText: formatRub(o.totalsumm),
            createdAt: o.created_at,
            paid: paidIds.has(Number(o.id)),
        })),
    };
}

export async function executeClientDossierTool(args: any): Promise<any> {
    const query = String(args?.query ?? '').trim();
    if (!query) return { available: false, reason: 'Не указано, какого клиента искать.' };

    const cards = await findCards(query);
    if (cards.length === 0) {
        return { available: false, reason: `Карточка клиента по запросу «${query}» не найдена.` };
    }

    const dossiers = await Promise.all(cards.map(cardDossier));
    return {
        available: true,
        found: dossiers.length,
        // Несколько карточек одного покупателя — обычное дело: об этом и нужно
        // сказать человеку, а не выбирать за него.
        clients: dossiers,
    };
}
