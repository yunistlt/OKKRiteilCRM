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
import { findOrCreateOwnClient } from './own-client';
import { itemLabel, managerName, moneyValue, statusName, writeOwnHistory } from './history-write';

/**
 * С какого номера идут наши строки заказов. `orders.id` у приехавших — это
 * идентификатор RetailCRM (сейчас ~55 тысяч), 900 млн он не достигнет никогда.
 */
export const OWN_ID_BASE = 900_000_000;
/** База человеческого номера своего заказа: 900001, 900002… */
export const OWN_NUMBER_BASE = 900_000;

/**
 * Юрлицо (магазин) новых своих заказов — ООО «ЗМК» (Точка Банк), решение
 * владельца 05.10.2026.
 *
 * Раньше здесь стоял собственный код `own-crm`, которого нет в справочнике
 * витрин. В карточке такое значение не переводилось на человеческий язык, и
 * менеджер видел слагом чужое имя вместо своего юрлица; реквизиты, расчётный
 * счёт и НДС из него тоже не выводятся. Юрлицо меняется в карточке заказа.
 */
export const OWN_SITE = 'zmktlt-ru';

/**
 * Номера для позиций, которые добавили мы.
 *
 * `order_items.id` — общий на все заказы первичный ключ, и у позиций RetailCRM
 * он уже дошёл до 106 857 и растёт. Если нумеровать свои позиции с единицы,
 * триггер состава по `ON CONFLICT (id)` перепишет чужую позицию и перевесит её
 * на наш заказ. Считать от номера заказа тоже нельзя: у забранного заказа
 * RetailCRM номер маленький, и арифметика уезжает в чужой диапазон. Поэтому
 * номера выдаёт отдельный счётчик `own_order_item_seq`.
 */
export async function ownItemIds(count: number): Promise<number[]> {
    if (count <= 0) {
        return [];
    }

    const { data, error } = await supabase.rpc('next_own_order_item_ids', { count_needed: count });
    const ids = ((data ?? []) as any[]).map((row) => Number(typeof row === 'object' ? Object.values(row)[0] : row));

    if (error || ids.length !== count || ids.some((id) => !Number.isFinite(id))) {
        // Счётчик недоступен — берём от максимума своих позиций, чтобы правка
        // состава не встала совсем. Чужой диапазон всё равно не трогаем.
        const { data: rows } = await supabase
            .from('order_items')
            .select('id')
            .gte('id', OWN_ID_BASE)
            .order('id', { ascending: false })
            .limit(1);
        const start = Number((rows as any[])?.[0]?.id ?? OWN_ID_BASE) + 1;
        return Array.from({ length: count }, (_, index) => start + index);
    }

    return ids;
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
/**
 * Номер своего заказа: 900001, 900002…
 *
 * Шесть знаков и девятка в начале — на разряд длиннее номеров RetailCRM (54935),
 * поэтому свой заказ виден сразу и ни с чем не путается. Прежний формат с
 * кириллической «А» («1039А») оказался неудобен: буква мешала в поиске, ломала
 * ссылки и пути в хранилище (решение владельца 02.10.2026).
 */
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
        return { number: String(OWN_NUMBER_BASE + seq), seq };
    }

    const seq = Number(data);
    return { number: String(OWN_NUMBER_BASE + seq), seq };
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

    /**
     * Клиент заказа — карточка в НАШЕЙ базе.
     *
     * Раньше заявка ссылалась на карточку RetailCRM, которой у нас нет, и в
     * заказе пустовали компания и реквизиты (разбор заказа 1039А, 02.10.2026).
     * Ищем по ИНН, затем по названию с почтой или телефоном, не нашли — заводим
     * свою. В RetailCRM такие карточки не уходят.
     */
    const contragent = orderData.contragent || {};
    const customerHints = {
        inn: contragent.INN || orderData.inn || null,
        companyName: contragent.legalName || orderData.companyName || orderData.customer?.nickName || null,
        email: orderData.email || null,
        phone: orderData.phone || (orderData.phones || [])[0]?.number || null,
        contactName: [orderData.firstName, orderData.lastName].filter(Boolean).join(' ') || null,
    };
    const client = await findOrCreateOwnClient(customerHints);
    const itemIds = await ownItemIds((orderData.items || []).length);
    const id = OWN_ID_BASE + seq;
    const total = itemsTotal(orderData.items);

    const payload = {
        ...orderData,
        id,
        number,
        site: OWN_SITE,
        // Клиента карточка читает из `customer.id` — закон проекта.
        ...(client
            ? {
                customer: {
                    ...(orderData.customer || {}),
                    id: client.id,
                    type: 'customer_corporate',
                    ...(customerHints.companyName ? { nickName: customerHints.companyName } : {}),
                },
            }
            : {}),
        createdAt: orderData.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
        currency: orderData.currency || 'RUB',
        totalSumm: orderData.totalSumm ?? total,
        summ: orderData.summ ?? total,
        // Позициям нужны номера в нашем диапазоне и название в `offer`: карточка,
        // документы и состав читают именно `offer.name`.
        items: (orderData.items || []).map((item: any, index: number) => ({
            ...item,
            id: item.id ?? itemIds[index],
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

    // История с первой секунды: создание заказа — это уже событие, как в
    // RetailCRM (требование владельца 02.10.2026). Пишем статус, менеджера,
    // сумму и состав — то же, что показывает их история нового заказа.
    const managerId = orderData.managerId ? Number(orderData.managerId) : null;
    await writeOwnHistory(
        id,
        [
            { field: 'status', newValue: await statusName(payload.status || 'novyi-1') },
            ...(managerId ? [{ field: 'manager', newValue: await managerName(managerId) }] : []),
            ...(payload.orderMethod ? [{ field: 'order_method', newValue: String(payload.orderMethod) }] : []),
            ...(payload.customerComment ? [{ field: 'customer_comment', newValue: String(payload.customerComment) }] : []),
            ...(payload.managerComment ? [{ field: 'manager_comment', newValue: String(payload.managerComment) }] : []),
            ...(payload.items || []).map((item: any) => ({
                field: 'order_product',
                newValue: itemLabel({
                    name: item.offer?.name || item.productName,
                    quantity: item.quantity,
                    price: item.price ?? item.initialPrice,
                }),
            })),
            { field: 'summ', newValue: moneyValue(payload.totalSumm ?? total) },
        ],
        managerId,
    );

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
