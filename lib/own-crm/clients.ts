/**
 * Клиент: карточка, реквизиты и связанные карточки.
 *
 * Два факта, вскрытые при переезде (29.09.2026) — на них тут всё построено:
 *
 * 1. Реквизиты в RetailCRM привязаны к ЗАКАЗУ, а не к карточке клиента.
 *    У покупателя в `customer.contragent` почти всегда пусто, а полный
 *    контрагент (ИНН, КПП, банк, юрадрес) лежит на заказе. Поэтому реквизиты
 *    клиента берём из его последнего заказа, где они есть.
 * 2. Одно юрлицо заведено в CRM несколькими карточками. Их связь уже посчитана
 *    в `salary_client_canon` — читаем её, ничего там не меняя.
 *
 * Номер клиента — это `clients.id` (он же `customer.id` в заказе). Колонка
 * `external_id` заполнена лишь у 640 карточек из 20 695 и опорой быть не может.
 */
import { supabase } from '@/utils/supabase';
import { loadClientRequisites } from './client-requisites';

export { isReseller } from './okved';

/**
 * Реквизиты клиента — ОДИН читатель на весь проект:
 * `loadClientRequisites` в `client-requisites.ts`.
 *
 * Здесь когда-то жила своя урезанная версия на четыре поля (ИНН, КПП,
 * название, юрадрес). Карточка клиента читала обе: полную — отдельным
 * запросом, урезанную — вместе с заказами и звонками. Ответы приходили
 * вперемешку, урезанный приходил последним и затирал банк, ОГРН и подписанта
 * — в карточке они то были, то пропадали (жалоба 09.10.2026). Второго
 * читателя быть не должно.
 */
export { loadClientRequisites } from './client-requisites';

export type RelatedClient = {
    customerId: string;
    name: string | null;
    ordersCount: number | null;
    totalSumm: number | null;
    /** Почему связали: одно юрлицо по канону или совпал ИНН. */
    reason: 'канон' | 'ИНН';
};

/**
 * Карточки того же юрлица. Не сливаем их — показываем менеджеру связь,
 * решение за человеком.
 */
export async function relatedClients(customerId: number | string): Promise<RelatedClient[]> {
    const id = String(customerId);

    const { data: mine } = await supabase
        .from('salary_client_canon')
        .select('group_key')
        .eq('cust_id', id)
        .maybeSingle();

    const found = new Map<string, RelatedClient['reason']>();

    if ((mine as any)?.group_key) {
        const { data: group } = await supabase
            .from('salary_client_canon')
            .select('cust_id')
            .eq('group_key', (mine as any).group_key);

        for (const row of (group || []) as any[]) {
            if (String(row.cust_id) !== id) {
                found.set(String(row.cust_id), 'канон');
            }
        }
    }

    const { inn } = await loadClientRequisites(id);
    if (inn) {
        const { data: sameInn } = await supabase
            .from('clients')
            .select('id')
            .eq('inn', inn);

        for (const row of (sameInn || []) as any[]) {
            if (String(row.id) !== id && !found.has(String(row.id))) {
                found.set(String(row.id), 'ИНН');
            }
        }
    }

    if (!found.size) {
        return [];
    }

    const { data: cards } = await supabase
        .from('clients')
        .select('id, company_name, orders_count, total_summ')
        .in('id', Array.from(found.keys()));

    return (cards || []).map((card: any) => ({
        customerId: String(card.id),
        name: card.company_name || null,
        ordersCount: card.orders_count ?? null,
        totalSumm: card.total_summ ?? null,
        reason: found.get(String(card.id)) || 'канон',
    }));
}


/**
 * Компания контактного лица.
 *
 * Заказ бывает заведён не на компанию, а на живого человека: в `customer`
 * стоит контактное лицо, и ссылка «карточка заказчика» вела на экран юрлиц,
 * где его нет, — менеджер видел «Клиент не найден» (жалоба Евгении 05.10.2026,
 * заказ 900024). Связь человек → компания уже посчитана в `client_contacts`
 * по заказам, поэтому карточку находим через неё, а не правим заказы: их
 * `raw_payload` переписывает ближайшая синхронизация с RetailCRM.
 *
 * Человек бывает контактом нескольких компаний (760 таких из 13 880) —
 * берём ту, где у него больше заказов, при равенстве более свежую.
 */
export async function companyOfContact(personId: number | string): Promise<number | null> {
    const { data } = await supabase
        .from('client_contacts')
        .select('client_id, orders_count, last_order_at')
        .eq('contact_id', String(personId))
        .order('orders_count', { ascending: false, nullsFirst: false })
        .order('last_order_at', { ascending: false, nullsFirst: false })
        .limit(1);

    const row = (data || [])[0] as any;
    return row?.client_id ? Number(row.client_id) : null;
}

/**
 * Карточка клиента, которую надо открыть по заказу: сам заказчик, если он
 * юрлицо, иначе компания его контактного лица. Вернёт null, когда компании
 * нет вовсе — тогда интерфейс объясняет человеку, что заводить.
 */
export async function clientCardIdForOrder(customerId: number | string | null): Promise<number | null> {
    if (!customerId) return null;

    const { data: card } = await supabase.from('clients').select('id').eq('id', String(customerId)).maybeSingle();
    if (card) return Number((card as any).id);

    return companyOfContact(customerId);
}
