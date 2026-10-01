/**
 * Свои заказы — те, что живут только у нас.
 *
 * Решение владельца 30.09.2026: один менеджер переходит целиком на нашу базу.
 * Заказы, которые бот заводит на него, создаются здесь и в RetailCRM не уходят.
 * Так мы проверяем систему на живой работе, не задев остальных менеджеров: у
 * них всё по-прежнему через RetailCRM.
 *
 * Три вещи, которых у своего заказа нет, и поэтому они сделаны здесь:
 * - номера. Номер берём из своего счётчика и добавляем букву «А» (1001А):
 *   номер никогда не столкнётся с номером RetailCRM, и по номеру сразу видно,
 *   чей это заказ;
 * - защиты от сверки. Часовая сверка удалённых считает удалённым всё, чего нет
 *   в RetailCRM, — своих заказов там нет по определению, поэтому она обходит их
 *   по флагу `is_own`;
 * - оплат. Провести платёж в RetailCRM негде — свой журнал в `payments.ts`.
 *
 * Данные складываем в тот же вид, что присылает RetailCRM: колонки заполняет
 * тот же триггер, и все читатели (карточка, документы, боты) не различают,
 * откуда заказ.
 */
import { supabase } from '@/utils/supabase';
import { orderTotal, validateNewOrder, type NewOrder, type NewOrderItem, type CreatedOrder } from './create-order';
import { OWN_ID_BASE, OWN_SITE, isOwnCrmManager, nextOwnOrderNumber, ownItemIds } from './own-order-insert';

export { isOwnCrmManager, nextOwnOrderNumber };

/** Статус по умолчанию — «Новая». */
const DEFAULT_STATUS = 'novyi-1';

/** Кто переведён на нашу базу — для настроек и объяснений человеку. */
export async function ownCrmManagers(): Promise<Array<{ id: number; name: string }>> {
    const { data } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .eq('own_crm', true);

    return ((data ?? []) as any[]).map((m) => ({
        id: Number(m.id),
        name: [m.last_name, m.first_name].filter(Boolean).join(' ') || `Менеджер ${m.id}`,
    }));
}

/** Заказ в том же виде, в котором его присылает RetailCRM. */
function buildPayload(order: NewOrder, params: { id: number; number: string; site: string; itemIds: number[] }) {
    const now = new Date();
    return {
        id: params.id,
        number: params.number,
        site: params.site,
        status: order.statusCode || DEFAULT_STATUS,
        createdAt: now.toISOString().slice(0, 19).replace('T', ' '),
        firstName: order.contactName || order.companyName || 'Клиент',
        ...(order.phone ? { phone: order.phone } : {}),
        ...(order.email ? { email: order.email } : {}),
        ...(order.customerComment ? { customerComment: order.customerComment } : {}),
        ...(order.managerComment ? { managerComment: order.managerComment } : {}),
        ...(order.managerId ? { managerId: order.managerId } : {}),
        ...(order.customerId ? { customer: { id: order.customerId, type: 'customer_corporate' } } : {}),
        orderMethod: 'crm-manager',
        currency: 'RUB',
        totalSumm: orderTotal(order.items),
        summ: orderTotal(order.items),
        items: order.items.map((item, index) => itemPayload(item, params.itemIds[index])),
        customFields: {},
    };
}

function itemPayload(item: NewOrderItem, id: number) {
    const price = Number(item.price) || 0;
    return {
        id,
        productName: item.name.trim(),
        // Название состава читают из offer.name — и карточка, и КП со счётом.
        offer: {
            name: item.name.trim(),
            ...(item.xmlId ? { xmlId: item.xmlId } : {}),
            ...(item.article ? { article: item.article } : {}),
        },
        initialPrice: price,
        price,
        quantity: Number(item.quantity),
        ...(item.xmlId || item.article
            ? { offer: { ...(item.xmlId ? { xmlId: item.xmlId } : {}), ...(item.article ? { article: item.article } : {}) } }
            : {}),
    };
}

/**
 * Завести свой заказ.
 *
 * Магазин пишем свой код `own-crm`: это не магазин RetailCRM, и подставлять
 * чужой нельзя — иначе правка попробует уйти в CRM и получит «Not found».
 */
export async function createOwnOrder(order: NewOrder): Promise<CreatedOrder> {
    const problems = validateNewOrder(order);
    if (problems.length) {
        throw new Error(problems.join('; '));
    }

    const { number, seq } = await nextOwnOrderNumber();
    const id = OWN_ID_BASE + seq;
    const site = OWN_SITE;
    const itemIds = await ownItemIds(order.items.length);

    const { error } = await supabase.from('orders').insert({
        id,
        order_id: id,
        number,
        site,
        status: order.statusCode || DEFAULT_STATUS,
        manager_id: order.managerId ?? null,
        is_own: true,
        created_at: new Date().toISOString(),
        raw_payload: buildPayload(order, { id, number, site, itemIds }),
    });

    if (error) {
        throw new Error(`Не удалось завести заказ у нас: ${error.message}`);
    }

    return { id, number, site };
}

/**
 * Поправить свой заказ: меняем `raw_payload`, колонки и позиции подтянет
 * триггер — тот же, что и для приехавших из RetailCRM.
 */
export async function editOwnOrder(
    rowId: number,
    edit: {
        items?: Array<{ id?: number | null; name: string; quantity: number; price: number; xmlId?: string | null }>;
        customerComment?: string | null;
        managerComment?: string | null;
        statusCode?: string | null;
        managerId?: number | null;
        customFields?: Record<string, unknown>;
        contact?: Record<string, unknown>;
        delivery?: Record<string, unknown>;
    },
): Promise<void> {
    const { data, error } = await supabase
        .from('orders')
        .select('raw_payload')
        .eq('id', rowId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    const payload: any = { ...(((data as any)?.raw_payload) || {}) };

    if (edit.items) {
        // Номера нужны только новым позициям; у приехавших из RetailCRM они свои.
        const fresh = await ownItemIds(edit.items.filter((item) => !item.id).length);
        let freshIndex = 0;
        payload.items = edit.items.map((item) =>
            itemPayload(item as NewOrderItem, Number(item.id) || fresh[freshIndex++]),
        );
        const total = edit.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
        payload.totalSumm = total;
        payload.summ = total;
    }
    if (edit.customerComment !== undefined) payload.customerComment = edit.customerComment ?? '';
    if (edit.managerComment !== undefined) payload.managerComment = edit.managerComment ?? '';
    if (edit.statusCode) payload.status = edit.statusCode;
    if (edit.managerId) payload.managerId = edit.managerId;
    if (edit.customFields && Object.keys(edit.customFields).length) {
        payload.customFields = { ...(payload.customFields || {}), ...edit.customFields };
    }
    for (const [key, value] of Object.entries(edit.contact || {})) {
        if (value !== undefined) payload[key] = value;
    }
    if (edit.delivery && Object.keys(edit.delivery).length) {
        payload.delivery = { ...(payload.delivery || {}) };
        if (edit.delivery.address !== undefined) payload.delivery.address = { text: String(edit.delivery.address ?? '') };
        if (edit.delivery.cost !== undefined) payload.delivery.cost = Number(edit.delivery.cost) || 0;
    }

    const update: Record<string, unknown> = { raw_payload: payload };
    if (edit.statusCode) update.status = edit.statusCode;
    if (edit.managerId) update.manager_id = edit.managerId;

    const { error: e } = await supabase.from('orders').update(update).eq('id', rowId);
    if (e) throw new Error(e.message);
}

/** Наш это заказ или приехал из RetailCRM. */
export async function isOwnOrder(rowId: number): Promise<boolean> {
    const { data } = await supabase.from('orders').select('is_own').eq('id', rowId).maybeSingle();
    return Boolean((data as any)?.is_own);
}
