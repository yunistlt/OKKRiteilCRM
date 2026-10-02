/**
 * Правка заказа из нашего интерфейса: состав, цены, комментарии, доп. поля.
 *
 * Пишем в RetailCRM методом `orders/edit` — пока обе системы живые, заказ должен
 * меняться там, иначе производство и зарплата увидят старую версию.
 *
 * Две вещи, на которых это ломается, и обе объясняем человеку словами:
 * - рубильник исходящих записей (`retailcrm_outbound_writes`) выключен;
 * - магазин заказа не принимается RetailCRM — так 30.09.2026 встали 5 132 заказа
 *   магазина `zmktlt-ru`, и никакая правка по ним невозможна в принципе.
 */
import { supabase } from '@/utils/supabase';
import { getCrmConfig } from '@/lib/retailcrm/leads';
import { isRetailcrmOutboundWriteEnabled, RETAILCRM_WRITE_BLOCKED_MESSAGE } from '@/lib/retailcrm/outbound-guard';
import { usableManagerId } from './create-order';
import { editOwnOrder } from './own-orders';

export type EditableItem = {
    /** id позиции в RetailCRM. Пусто — позиция новая. */
    id?: number | null;
    name: string;
    quantity: number;
    /** Цена за единицу ДО скидки (в RetailCRM это initialPrice). */
    price: number;
    /** Скидка рублями на единицу. */
    discountAmount?: number | null;
    /** Скидка процентом от цены единицы. */
    discountPercent?: number | null;
    xmlId?: string | null;
};

export type OrderEdit = {
    items?: EditableItem[];
    /** Разовая скидка на заказ: рублями и процентом, как в RetailCRM. */
    discountAmount?: number | null;
    discountPercent?: number | null;
    customerComment?: string | null;
    managerComment?: string | null;
    statusCode?: string | null;
    managerId?: number | null;
    customFields?: Record<string, unknown>;
    /** Поля самого заказа: имя контакта, телефон, почта. */
    contact?: Record<string, unknown>;
    /** Доставка: адрес и стоимость. */
    delivery?: Record<string, unknown>;
};

export type EditResult =
    | { ok: true; changed: string[] }
    | { ok: false; reason: string };

/** Что именно меняем — человеческим языком, для ленты событий и ответа. */
export function describeEdit(edit: OrderEdit): string[] {
    const changed: string[] = [];
    if (edit.items) changed.push('состав заказа');
    if (edit.discountAmount !== undefined || edit.discountPercent !== undefined) changed.push('разовую скидку');
    if (edit.customerComment !== undefined) changed.push('комментарий клиента');
    if (edit.managerComment !== undefined) changed.push('комментарий менеджера');
    if (edit.statusCode) changed.push('статус');
    if (edit.managerId) changed.push('менеджер');
    if (edit.customFields && Object.keys(edit.customFields).length) changed.push('дополнительные поля');
    if (edit.contact && Object.keys(edit.contact).length) changed.push('контактные данные');
    if (edit.delivery && Object.keys(edit.delivery).length) changed.push('доставку');
    return changed;
}

/** Проверка состава до отправки. */
export function validateItems(items: EditableItem[]): string[] {
    const problems: string[] = [];

    if (!items.length) {
        problems.push('В заказе должна остаться хотя бы одна позиция');
    }

    items.forEach((item, index) => {
        if (!item.name?.trim()) problems.push(`Позиция ${index + 1}: не указано название`);
        if (!(Number(item.quantity) > 0)) problems.push(`Позиция ${index + 1}: количество должно быть больше нуля`);
        if (Number(item.price) < 0) problems.push(`Позиция ${index + 1}: цена не может быть отрицательной`);
    });

    return problems;
}

/**
 * Заказ ищем и по нашему номеру строки, и по идентификатору RetailCRM: карточка
 * заказа в интерфейсе работает с их номером, а реестр — с нашим.
 */
async function findOrder(orderKey: number) {
    const byCrm = await supabase
        .from('orders')
        .select('id, order_id, number, site, is_own')
        .eq('order_id', orderKey)
        .maybeSingle();

    if (byCrm.data) {
        return byCrm.data as any;
    }

    const byRow = await supabase
        .from('orders')
        .select('id, order_id, number, site, is_own')
        .eq('id', orderKey)
        .maybeSingle();

    if (byRow.data) {
        return byRow.data as any;
    }

    // Заказ может быть создан минуту назад и ещё не приехать к нам
    // синхронизацией — тогда спрашиваем саму RetailCRM. Иначе только что
    // созданный заказ нельзя было бы поправить.
    const { url, key } = await getCrmConfig();
    const response = await fetch(`${url}/api/v5/orders/${orderKey}?by=id&apiKey=${key}`);
    const payload = await response.json().catch(() => null);
    if (payload?.order) {
        return { id: payload.order.id, order_id: payload.order.id, number: payload.order.number, site: payload.order.site };
    }

    return null;
}

export async function editOrder(orderKey: number, edit: OrderEdit): Promise<EditResult> {
    if (edit.items) {
        const problems = validateItems(edit.items);
        if (problems.length) {
            return { ok: false, reason: problems.join('; ') };
        }
    }

    const order = await findOrder(orderKey);
    if (!order) {
        return { ok: false, reason: 'Заказ не найден' };
    }

    // Свой заказ правим у себя: в RetailCRM его нет, и рубильник исходящих
    // записей к нему не относится — он про чужие заказы.
    if ((order as any).is_own) {
        await editOwnOrder(Number((order as any).id), edit);
        return { ok: true, changed: describeEdit(edit) };
    }

    if (!(await isRetailcrmOutboundWriteEnabled())) {
        return { ok: false, reason: RETAILCRM_WRITE_BLOCKED_MESSAGE };
    }

    const crmOrderId = (order as any).order_id;
    const site = (order as any).site;
    const orderData: any = {};

    if (edit.items) {
        // RetailCRM заменяет состав целиком: присылаем все позиции, которые должны
        // остаться. Позиция без id считается новой, пропавшая — удалённой.
        orderData.items = edit.items.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            productName: item.name.trim(),
            quantity: Number(item.quantity),
            initialPrice: Number(item.price),
            // Скидку позиции отдаём их же полями — пересчёт цены делает RetailCRM.
            ...(item.discountAmount ? { discountManualAmount: Number(item.discountAmount) } : {}),
            ...(item.discountPercent ? { discountManualPercent: Number(item.discountPercent) } : {}),
            ...(item.xmlId ? { offer: { xmlId: item.xmlId } } : {}),
        }));
    }

    // Разовая скидка на заказ. Ноль отправляем тоже: так скидку снимают.
    if (edit.discountAmount !== undefined) orderData.discountManualAmount = Number(edit.discountAmount) || 0;
    if (edit.discountPercent !== undefined) orderData.discountManualPercent = Number(edit.discountPercent) || 0;

    if (edit.customerComment !== undefined) orderData.customerComment = edit.customerComment ?? '';
    if (edit.managerComment !== undefined) orderData.managerComment = edit.managerComment ?? '';
    if (edit.statusCode) orderData.status = edit.statusCode;
    // Менеджера шлём только настоящего: у внутренних учёток бывает номер,
    // которого в RetailCRM нет, и тогда отклоняется вся правка.
    const managerId = await usableManagerId(edit.managerId);
    if (managerId) orderData.managerId = managerId;
    if (edit.customFields && Object.keys(edit.customFields).length) orderData.customFields = edit.customFields;

    // Контактные данные заказа кладём как есть: имена полей у RetailCRM свои,
    // и мы их не переводим.
    for (const [key, value] of Object.entries(edit.contact || {})) {
        if (value !== undefined) {
            orderData[key] = value;
        }
    }

    if (edit.delivery && Object.keys(edit.delivery).length) {
        orderData.delivery = {};
        if (edit.delivery.address !== undefined) {
            orderData.delivery.address = { text: String(edit.delivery.address ?? '') };
        }
        if (edit.delivery.cost !== undefined) {
            orderData.delivery.cost = Number(edit.delivery.cost) || 0;
        }
    }

    if (!Object.keys(orderData).length) {
        return { ok: true, changed: [] };
    }

    const { url, key } = await getCrmConfig();
    const body = new URLSearchParams();
    body.append('order', JSON.stringify(orderData));
    body.append('site', site);
    body.append('by', 'id');

    const response = await fetch(
        `${url}/api/v5/orders/${crmOrderId}/edit?apiKey=${key}&by=id&site=${encodeURIComponent(site)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    );

    const result = await response.json();
    if (!result?.success) {
        const raw = result?.errorMsg || (result?.errors ? JSON.stringify(result.errors) : 'неизвестная ошибка');

        if (String(raw).includes("parameter 'site'")) {
            return {
                ok: false,
                reason: `RetailCRM не принимает магазин «${site}», в котором лежит этот заказ — сбой на их стороне. `
                    + 'Править такой заказ нельзя ни отсюда, ни у них, пока магазин не починят.',
            };
        }

        return { ok: false, reason: `RetailCRM отклонила правку: ${raw}` };
    }

    return { ok: true, changed: describeEdit(edit) };
}
