import { supabase } from '@/utils/supabase';

/**
 * Один читатель контактов заказа: куда писать и куда звонить.
 *
 * Почта и телефон лежат в двух местах — в самом заказе (контактное лицо, с
 * которым работали) и в карточке клиента (общие адреса компании). Раньше это
 * раскладывал каждый, кому понадобилось: досье заказа, поиск заказов, а письмо
 * помощника вообще требовало адрес от модели — и на «напиши клиенту» человек
 * получал «уточните email», хотя адрес лежал в карточке. Правило то же, что у
 * реквизитов клиента: один читатель, остальные зовут его.
 */

export type OrderContact = {
    /** Почта: сначала из заказа, иначе из карточки клиента. */
    email: string | null;
    /** Телефон: в заказе он бывает контактного лица, в карточке — компании. */
    phone: string | null;
};

type ClientCard = { email?: unknown; phones?: unknown } | null | undefined;

/** Телефоны в карточке лежат списком: либо объектами, либо строками. */
function firstPhone(phones: unknown): string | null {
    if (!Array.isArray(phones) || phones.length === 0) return null;
    const first = phones[0] as any;
    const value = typeof first === 'string' ? first : first?.number;
    return typeof value === 'string' && value.trim() ? value : null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

/** Разложить контакты по уже прочитанной строке заказа и карточке клиента. */
export function orderContactFrom(order: any, card?: ClientCard): OrderContact {
    const email =
        text(order?.raw_payload?.email) ??
        text(order?.customer?.email) ??
        text(order?.contact?.email) ??
        text(card?.email);
    const phone =
        text(order?.raw_payload?.phone) ??
        firstPhone(order?.contact?.phones) ??
        firstPhone(card?.phones);
    return { email, phone };
}

/** Прочитать карточки клиентов пачкой — для списков заказов. */
export async function loadClientCards(clientIds: Array<number | null | undefined>): Promise<Map<number, ClientCard>> {
    const ids = Array.from(new Set(clientIds.filter((id): id is number => Boolean(id))));
    const byId = new Map<number, ClientCard>();
    if (ids.length === 0) return byId;
    const { data } = await supabase.from('clients').select('id, email, phones').in('id', ids);
    for (const row of (data ?? []) as any[]) byId.set(Number(row.id), { email: row.email, phones: row.phones });
    return byId;
}

/**
 * Контакты заказа по его номеру — для тех, у кого на руках только номер
 * (письмо и звонок помощника). Удалённый в CRM заказ не отдаём: писать по нему
 * некому.
 */
export async function loadOrderContact(orderNumber: string): Promise<
    { number: string; customer: string | null } & OrderContact | null
> {
    const { data } = await supabase
        .from('orders')
        .select('number, customer, customer_id, contact, raw_payload')
        .eq('number', String(orderNumber).trim())
        .is('crm_deleted_at', null)
        .maybeSingle();
    if (!data) return null;

    const order = data as any;
    let card: ClientCard = null;
    if (order.customer_id) {
        const { data: row } = await supabase
            .from('clients')
            .select('email, phones')
            .eq('id', order.customer_id)
            .maybeSingle();
        card = row as ClientCard;
    }

    const contact = orderContactFrom(order, card);
    return {
        number: String(order.number),
        customer: order.customer?.nickName ?? order.raw_payload?.contragent?.legalName ?? null,
        ...contact,
    };
}
