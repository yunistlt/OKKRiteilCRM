import { supabase } from '@/utils/supabase';
import { getCrmConfig } from '@/lib/retailcrm/leads';

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
    const { url, key } = await getCrmConfig();

    const res = await fetch(`${url}/api/v5/orders?filter[numbers][]=${encodeURIComponent(orderNumber)}&limit=20`, {
        headers: { 'X-API-KEY': key },
    });
    const data = await res.json();
    const o = (data.orders ?? [])[0];
    if (!o) return null;

    const orderId = Number(o.id);

    const [{ data: historyRows }, { data: statusNames }, { data: callRows }] = await Promise.all([
        supabase.rpc('sales_order_full_history', { p_order_id: orderId }),
        supabase.from('statuses').select('code, name'),
        supabase.rpc('sales_client_calls_by_order', { p_order_id: orderId }),
    ]);

    const nameByCode = new Map(((statusNames ?? []) as any[]).map((r) => [r.code, r.name]));

    const history = ((historyRows ?? []) as any[]).map((r) => ({
        date: String(r.occurred_at).slice(0, 16).replace('T', ' '),
        kind: String(r.kind),
        detail: String(r.detail ?? ''),
    }));

    return {
        number: String(o.number),
        orderId,
        status: nameByCode.get(o.status) || o.status,
        amount: Number(o.totalSumm ?? 0),
        customer: o.customer?.nickName ?? null,
        createdAt: String(o.createdAt ?? '').slice(0, 10),
        nextContactDate: o.customFields?.data_kontakta ?? null,
        managerComment: String(o.managerComment ?? ''),
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
