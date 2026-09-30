/**
 * Развилка «куда завести заказ»: в RetailCRM или сразу у нас.
 *
 * Решение владельца 30.09.2026: один менеджер работает целиком в нашей базе.
 * Все три потока заявок (почта — Катерина, виджет — Елена, звонок — секретарь
 * Телфина) собирают заказ в виде RetailCRM и отправляют его туда. Здесь мы
 * перед отправкой смотрим, на кого заявка назначена: если на менеджера с
 * флагом `own_crm` — заказ остаётся у нас, в RetailCRM не уходит.
 *
 * Ответ намеренно той же формы, что даёт RetailCRM (`success`, `id`,
 * `order.number`): вызывающий код не должен знать, куда ушёл заказ.
 *
 * Файл держим отдельным и зависящим только от базы: иначе `leads.ts` и
 * `create-order.ts` начинают ссылаться друг на друга по кругу.
 */
import { supabase } from '@/utils/supabase';

/**
 * С какого номера идут наши строки заказов. `orders.id` у приехавших — это
 * идентификатор RetailCRM (сейчас ~55 тысяч), 900 млн он не достигнет никогда.
 */
export const OWN_ID_BASE = 900_000_000;

/** Магазин своих заказов. Это не магазин RetailCRM — подставлять чужой нельзя. */
export const OWN_SITE = 'own-crm';

/**
 * Номер позиции своего заказа.
 *
 * `order_items.id` — общий на все заказы первичный ключ, и у позиций RetailCRM
 * он уже дошёл до 106 857 и растёт. Если нумеровать свои позиции с единицы,
 * триггер состава по `ON CONFLICT (id)` перепишет чужую позицию и перевесит её
 * на наш заказ. Поэтому свои позиции живут в своём диапазоне: номер заказа × 1000
 * плюс номер строки.
 */
export function ownItemId(seq: number, index: number): number {
    return OWN_ID_BASE + seq * 1000 + index;
}

export type CrmLikeOrderResult = {
    success: boolean;
    id: number;
    number: string;
    order: { id: number; number: string; site: string };
    /** Признак для вызывающего: заказ остался у нас. */
    own: true;
};

/** Следующий номер своего заказа: 1001А. Буква — признак нашего заказа. */
export async function nextOwnOrderNumber(): Promise<{ number: string; seq: number }> {
    const { data, error } = await supabase.rpc('nextval_own_order_number');

    if (error || data === null || data === undefined) {
        // Счётчик недоступен — считаем от максимума своих строк, чтобы приём
        // заявок не встал из-за номера.
        const { data: rows } = await supabase
            .from('orders')
            .select('id')
            .gte('id', OWN_ID_BASE)
            .order('id', { ascending: false })
            .limit(1);
        const seq = Number((rows as any[])?.[0]?.id ?? OWN_ID_BASE) - OWN_ID_BASE + 1;
        return { number: `${1000 + seq}А`, seq };
    }

    const seq = Number(data);
    return { number: `${1000 + seq}А`, seq };
}

/** Работает ли этот менеджер в нашей базе. */
export async function isOwnCrmManager(managerId: number | null | undefined): Promise<boolean> {
    if (!managerId) return false;

    const { data } = await supabase
        .from('managers')
        .select('own_crm')
        .eq('id', managerId)
        .maybeSingle();

    return Boolean((data as any)?.own_crm);
}

function itemsTotal(items: any[] | undefined): number {
    return (items || []).reduce(
        (sum, item) => sum + (Number(item.initialPrice ?? item.price ?? 0) * Number(item.quantity ?? 0)),
        0,
    );
}

/**
 * Записать заказ у нас. `orderData` — тот же объект, который ушёл бы в
 * RetailCRM: колонки и позиции из него разложит тот же триггер, что и для
 * приехавших заказов.
 */
export async function insertOwnOrder(orderData: any): Promise<CrmLikeOrderResult> {
    const { number, seq } = await nextOwnOrderNumber();
    const id = OWN_ID_BASE + seq;
    const total = itemsTotal(orderData.items);

    const payload = {
        ...orderData,
        id,
        number,
        site: OWN_SITE,
        createdAt: orderData.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
        currency: orderData.currency || 'RUB',
        totalSumm: orderData.totalSumm ?? total,
        summ: orderData.summ ?? total,
        // Позициям нужны номера в нашем диапазоне и название в `offer`: карточка,
        // документы и состав читают именно `offer.name`.
        items: (orderData.items || []).map((item: any, index: number) => ({
            ...item,
            id: item.id ?? ownItemId(seq, index + 1),
            price: item.price ?? item.initialPrice ?? 0,
            offer: item.offer?.name
                ? item.offer
                : { ...(item.offer || {}), name: item.productName || item.name || 'Позиция' },
        })),
        customFields: orderData.customFields || {},
    };

    const { error } = await supabase.from('orders').insert({
        id,
        order_id: id,
        number,
        site: OWN_SITE,
        status: orderData.status || 'novyi-1',
        manager_id: orderData.managerId ?? null,
        is_own: true,
        created_at: new Date().toISOString(),
        raw_payload: payload,
    });

    if (error) {
        throw new Error(`Не удалось завести заказ у нас: ${error.message}`);
    }

    return { success: true, id, number, order: { id, number, site: OWN_SITE }, own: true };
}

/**
 * Заказ назначен на менеджера нашей базы? Тогда `insertOwnOrder`, иначе `null`
 * — и вызывающий отправляет заказ в RetailCRM как раньше.
 */
export async function routeNewOrder(orderData: any): Promise<CrmLikeOrderResult | null> {
    if (!(await isOwnCrmManager(orderData?.managerId))) {
        return null;
    }

    return insertOwnOrder(orderData);
}
