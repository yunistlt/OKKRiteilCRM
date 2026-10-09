/**
 * Правка заказа из нашего интерфейса: состав, цены, комментарии, доп. поля.
 *
 * Пишем только в свою базу — при любом источнике заказа. RetailCRM с
 * 09.10.2026 архив на чтение, наружу не пишем вообще.
 */
import { supabase } from '@/utils/supabase';
import { editOwnOrder } from './own-orders';
import { prependComment } from './comment-entries';

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
    /** id товара на сайте — хранится в `offer.externalId`. */
    siteId?: string | null;
    /** Артикул товара. */
    article?: string | null;
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
    /** Реквизиты заказчика (ИНН, банк, юрадрес) — на заказе, как в RetailCRM. */
    contragent?: Record<string, unknown>;
    /**
     * Другой заказчик: карточка клиента, которой принадлежит заказ.
     * Менеджер меняет её, когда заказ завели не на то юрлицо (требование
     * владельца 02.10.2026, как в RetailCRM — там заказчика переключают
     * прямо в блоке «Клиент»).
     */
    customerId?: number | string | null;
    /**
     * Юрлицо (магазин) заказа. От него идут реквизиты продавца, расчётный счёт
     * и НДС — у АО «ЗВТО» его нет. Менеджер меняет его в карточке: раньше поле
     * было только для чтения, и заказ, заведённый не на то юрлицо, приходилось
     * переделывать (Лена Парфёнова 05.10.2026).
     */
    site?: string | null;
    /**
     * Какими днями считаем срок изготовления: `rabochie` или `kalendarnye`.
     * Поле наше — в RetailCRM его нет, поэтому пишем прямо в нашу таблицу и
     * для заказов RetailCRM тоже (просьба Евгении 05.10.2026).
     */
    productionDaysUnit?: string | null;
    /**
     * Причина отмены словами. Поле наше: в RetailCRM причина — только код из
     * справочника, а владелец 05.10.2026 просил подробный текст, «это потом
     * позволит делать анализ глубже».
     */
    cancelReasonText?: string | null;
};

export type EditResult =
    | { ok: true; changed: string[] }
    | { ok: false; reason: string };

/** Что именно меняем — человеческим языком, для ленты событий и ответа. */
export function describeEdit(edit: OrderEdit): string[] {
    const changed: string[] = [];
    if (edit.items) changed.push('состав заказа');
    if (edit.contragent && Object.keys(edit.contragent).length) changed.push('реквизиты заказчика');
    if (edit.discountAmount !== undefined || edit.discountPercent !== undefined) changed.push('разовую скидку');
    if (edit.customerComment !== undefined) changed.push('комментарий клиента');
    if (edit.managerComment !== undefined) changed.push('комментарий менеджера');
    if (edit.statusCode) changed.push('статус');
    if (edit.managerId) changed.push('менеджер');
    if (edit.customFields && Object.keys(edit.customFields).length) changed.push('дополнительные поля');
    if (edit.customerId) changed.push('заказчика');
    if (edit.contact && Object.keys(edit.contact).length) changed.push('контактные данные');
    if (edit.delivery && Object.keys(edit.delivery).length) changed.push('доставку');
    if (edit.site) changed.push('юрлицо заказа');
    if (edit.productionDaysUnit !== undefined) changed.push('единицу срока изготовления');
    if (edit.cancelReasonText !== undefined) changed.push('причину отмены');
    return changed;
}

/** Проверка состава до отправки. */
export function validateItems(items: EditableItem[]): string[] {
    const problems: string[] = [];

    // Пустой состав — не ошибка: заявка приходит до просчёта, позиций ещё нет,
    // а карточку надо сохранять (внести телефон, реквизиты). Решение владельца
    // 02.10.2026 — иначе менеджер не может сохранить страницу вообще.
    items.forEach((item, index) => {
        if (!item.name?.trim()) problems.push(`Позиция ${index + 1}: не указано название`);
        if (!(Number(item.quantity) > 0)) problems.push(`Позиция ${index + 1}: количество должно быть больше нуля`);
        if (Number(item.price) < 0) problems.push(`Позиция ${index + 1}: цена не может быть отрицательной`);
    });

    return problems;
}

/**
 * Заказ ищем и по номеру строки, и по идентификатору заказа: карточка заказа в
 * интерфейсе работает с одним, реестр — с другим.
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

    // Заказа нет у нас — значит нет нигде: заказы заводятся в ОКК, RetailCRM
    // больше не спрашиваем.
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

    // Единица срока — наша колонка, её храним у себя при любом источнике заказа.
    if (edit.productionDaysUnit !== undefined || edit.cancelReasonText !== undefined) {
        await supabase
            .from('orders')
            .update({
                ...(edit.productionDaysUnit !== undefined ? { srok_izgot_edinica: edit.productionDaysUnit || null } : {}),
                ...(edit.cancelReasonText !== undefined ? { prichina_otmeny_text: edit.cancelReasonText || null } : {}),
            })
            .eq('order_id', (order as any).order_id ?? orderKey);
    }

    /**
     * Правку сохраняем У СЕБЯ — и только у себя.
     *
     * Решение владельца 09.10.2026: «заказы из ритейла уже правятся только в
     * ОКК, забудь про ритейл». RetailCRM — архив на чтение, писать туда больше
     * незачем, и источник правды один: наша база. Раньше заказ оттуда правился
     * только через их `orders/edit`, и при выключенном рубильнике исходящих
     * записей правка отклонялась целиком — 7 396 старых заказов менеджеры не
     * могли ни двинуть по статусу, ни прокомментировать.
     */
    await editOwnOrder(Number((order as any).id), edit);
    return { ok: true, changed: describeEdit(edit) };
}

/**
 * Дописать запись в ленту комментария менеджера по заказу.
 *
 * Раньше такие пометки уезжали в RetailCRM полем `noteText` и ложились
 * заметкой заказа. Своей сущности «заметка» у нас нет намеренно: комментарий
 * менеджера — это лента записей с метками (см. `comment-entries.ts`), её
 * читают люди, письма, ОКК и бот-РОП. Поэтому пометки автоматики пишем туда
 * же — наверх ленты и с подписью, кто её поставил.
 */
export async function appendOrderNote(orderKey: number, note: string, author: string): Promise<void> {
    const text = String(note ?? '').trim();
    if (!text) return;

    const order = await findOrder(orderKey);
    if (!order) return;

    const { data } = await supabase.from('orders').select('raw_payload').eq('id', (order as any).id).maybeSingle();
    const was = String(((data as any)?.raw_payload?.managerComment) ?? '');

    await editOrder(Number((order as any).id), { managerComment: prependComment(was, text, author) });
}
