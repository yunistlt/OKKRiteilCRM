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
 */
import { supabase } from '@/utils/supabase';

export type ClientRequisites = {
    inn: string | null;
    kpp: string | null;
    legalName: string | null;
    legalAddress: string | null;
    /** Номер заказа, из которого взяты реквизиты — чтобы цифра раскладывалась. */
    fromOrderNumber: string | null;
};

/** Реквизиты клиента: из карточки, а чего нет — из последнего заказа с реквизитами. */
export async function clientRequisites(customerId: number | string): Promise<ClientRequisites> {
    const id = String(customerId);

    const { data: card } = await supabase
        .from('clients')
        .select('inn, kpp, company_name')
        .eq('external_id', id)
        .maybeSingle();

    const { data: orders } = await supabase
        .from('orders')
        .select('number, "contragent", "createdAt"')
        .filter('customer->>id', 'eq', id)
        .not('contragent->>INN', 'is', null)
        .order('createdAt', { ascending: false })
        .limit(1);

    const last = (orders || [])[0] as any;
    const fromOrder = last?.contragent || {};

    return {
        inn: (card as any)?.inn || fromOrder.INN || null,
        kpp: (card as any)?.kpp || fromOrder.KPP || null,
        legalName: fromOrder.legalName || (card as any)?.company_name || null,
        legalAddress: fromOrder.legalAddress || null,
        fromOrderNumber: last?.number || null,
    };
}

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

    const { inn } = await clientRequisites(id);
    if (inn) {
        const { data: sameInn } = await supabase
            .from('clients')
            .select('external_id')
            .eq('inn', inn);

        for (const row of (sameInn || []) as any[]) {
            if (String(row.external_id) !== id && !found.has(String(row.external_id))) {
                found.set(String(row.external_id), 'ИНН');
            }
        }
    }

    if (!found.size) {
        return [];
    }

    const { data: cards } = await supabase
        .from('clients')
        .select('external_id, company_name, orders_count, total_summ')
        .in('external_id', Array.from(found.keys()));

    return (cards || []).map((card: any) => ({
        customerId: String(card.external_id),
        name: card.company_name || null,
        ordersCount: card.orders_count ?? null,
        totalSumm: card.total_summ ?? null,
        reason: found.get(String(card.external_id)) || 'канон',
    }));
}
