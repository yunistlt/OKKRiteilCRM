import { supabase } from '@/utils/supabase';
import { loadStatusDirectory } from '@/lib/own-crm/status-code';

// Досье по одному заказу: всё, что о нём известно.
//
// Без этого инструмента Семён видел только статус и сумму — то есть ровно то,
// что менеджер и так читает на экране, — и писал рекомендации вида «уточните,
// есть ли вопросы по счёту». Между тем в комментарии карточки лежало:
// «проблема в доставке в контейнерах, могут не вовремя забрать, навигация,
// сдача объекта горит». Совет должен опираться на это, а не на сумму.
//
// Комментарий берём из живой CRM: менеджер дописывает его в течение дня, и
// вчерашняя копия здесь бесполезна. Историю и расшифровки — из нашей базы,
// в CRM их нет.

export type OrderDossier = {
    number: string;
    orderId: number;
    status: string;
    amount: number;
    customer: string | null;
    /** Куда писать и кому звонить: без этого письмо не составить. */
    email: string | null;
    phone: string | null;
    createdAt: string;
    nextContactDate: string | null;
    /** Комментарий из карточки — там менеджер ведёт хронику переговоров. */
    managerComment: string;
    /** Вся история: статусы, комментарии, правки суммы, письма. */
    history: Array<{ date: string; kind: string; detail: string }>;
    /** Звонки по клиенту, а не только по этому заказу. */
    calls: Array<{ date: string; orderNumber: string | null; transcript: string }>;
    lastTouchAt: string | null;
};

export async function orderDossier(orderNumber: string): Promise<OrderDossier | null> {
    // Заказ берём из нашей базы. До 02.11.2026 досье ходило в RetailCRM, и
    // после отвязки 09.10.2026 это стало враньём: по заказу 41989 оно отдавало
    // «ТД Карусель, Отложено», когда у нас он у «ООО Дети наше будущее» и уже
    // в производстве. RetailCRM — архив, он не пополняется.
    const { data: o, error } = await supabase
        .from('orders')
        .select('order_id, number, status, totalsumm, customer, customer_id, contact, createdAt, managerComment, raw_payload')
        .eq('number', orderNumber)
        .is('crm_deleted_at', null)
        .maybeSingle();

    if (error || !o) return null;

    const orderId = Number((o as any).order_id);

    const [{ data: historyRows }, statusRows, { data: callRows }] = await Promise.all([
        supabase.rpc('sales_order_full_history', { p_order_id: orderId }),
        loadStatusDirectory({ withInactive: true }),
        supabase.rpc('sales_client_calls_by_order', { p_order_id: orderId }),
    ]);

    const nameByCode = new Map(statusRows.map((row) => [row.code, row.name]));

    const history = ((historyRows ?? []) as any[]).map((r) => ({
        date: String(r.occurred_at).slice(0, 16).replace('T', ' '),
        kind: String(r.kind),
        detail: String(r.detail ?? ''),
    }));

    const order = o as any;

    // Почта заказа, иначе почта карточки клиента. Телефон — так же: в заказе
    // он бывает контактного лица, в карточке — самой компании.
    let email = order.raw_payload?.email
        ?? order.customer?.email
        ?? order.contact?.email
        ?? null;
    let phone = order.raw_payload?.phone
        ?? order.contact?.phones?.[0]?.number
        ?? null;

    if ((!email || !phone) && order.customer_id) {
        const { data: card } = await supabase
            .from('clients')
            .select('email, phones')
            .eq('id', order.customer_id)
            .maybeSingle();
        const cardPhones = (card as any)?.phones;
        email = email ?? (card as any)?.email ?? null;
        phone = phone ?? (Array.isArray(cardPhones) ? cardPhones[0]?.number ?? cardPhones[0] ?? null : null);
    }

    return {
        number: String(order.number),
        orderId,
        status: nameByCode.get(order.status) || order.status,
        amount: Number(order.totalsumm ?? 0),
        customer: order.customer?.nickName
            ?? order.raw_payload?.contragent?.legalName
            ?? null,
        email: typeof email === 'string' ? email : null,
        phone: typeof phone === 'string' ? phone : null,
        createdAt: String(order.createdAt ?? '').slice(0, 10),
        nextContactDate: order.raw_payload?.customFields?.data_kontakta ?? null,
        managerComment: String(order.managerComment ?? ''),
        history,
        calls: ((callRows ?? []) as any[]).map((r) => ({
            date: String(r.started_at).slice(0, 10),
            orderNumber: r.order_number ?? null,
            transcript: String(r.transcript ?? ''),
        })),
        lastTouchAt: history[0]?.date ?? null,
    };
}

export const ORDER_DOSSIER_TOOL = {
    type: 'function' as const,
    function: {
        name: 'order_dossier',
        description:
            'Всё, что известно про заказ: комментарий менеджера с хроникой переговоров, ПОЛНАЯ история (смены статусов, правки суммы и состава, отправленные письма) и расшифровки звонков — по этому заказу и по другим заказам того же клиента. Вызывай ПЕРЕД любым советом по заказу и прочитай целиком: суть обычно лежит не в статусе, а в записи двухнедельной давности.',
        parameters: {
            type: 'object',
            properties: {
                order_number: { type: 'string', description: 'Номер заказа' },
            },
            required: ['order_number'],
        },
    },
} as const;

export async function executeOrderDossierTool(args: any): Promise<any> {
    try {
        const d = await orderDossier(String(args?.order_number ?? '').trim());
        if (!d) return { available: false, reason: 'Заказа с таким номером нет' };
        return {
            source: 'комментарий и статус — из RetailCRM на сейчас, история и звонки — из нашей базы',
            ...d,
            amount: `${Math.round(d.amount).toLocaleString('ru-RU')} ₽`,
        };
    } catch (e: any) {
        return { available: false, reason: `Не удалось собрать досье: ${e.message}` };
    }
}
