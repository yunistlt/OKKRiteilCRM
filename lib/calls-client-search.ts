/**
 * Поиск звонков по наименованию клиента — как в RetailCRM.
 *
 * Просьба Евгении Матвеевой 05.10.2026: в RetailCRM в фильтре звонков есть поле
 * «Клиент», и разговоры находятся по названию компании. У нас поиск знал только
 * телефон, номер заказа и менеджера, поэтому «Комплексное оснащение» не
 * находило ничего.
 *
 * Названия компании у самого звонка нет: в `retailcrm_calls` лежат телефон,
 * номер заказа и иногда `customer_rc_id` (заполнен у 3 013 звонков из 19 889).
 * Поэтому по названию сначала находим клиентов, а потом всё, чем их звонок
 * может быть помечен: номера их заказов, их контактных лиц и их телефоны.
 */
import { supabase } from '@/utils/supabase';

/** Сколько карточек и заказов берём в расчёт: запрос уезжает в строку адреса. */
const MAX_CLIENTS = 100;
const MAX_ORDERS = 400;
const MAX_VALUES = 400;

export type ClientCallKeys = {
    /** Номера заказов найденных клиентов. */
    orderNumbers: string[];
    /** Идентификаторы клиентов и их контактных лиц — для `customer_rc_id`. */
    customerIds: string[];
    /** Телефоны из карточек — для звонков без заказа. */
    phones: string[];
};

function normalizePhone(value: any): string {
    return String(value ?? '').replace(/[^\d]/g, '');
}

/** Юрлица, чьё название похоже на запрос. */
async function findClients(text: string): Promise<any[]> {
    const like = `%${text}%`;
    const { data } = await supabase
        .from('clients')
        .select('id, phones')
        .or(`company_name.ilike.${like},legalName.ilike.${like},full_name.ilike.${like},contact_name.ilike.${like}`)
        .limit(MAX_CLIENTS);
    return (data || []) as any[];
}

/** Живые люди, чьё имя похоже на запрос: звонок бывает помечен человеком. */
async function findPeople(text: string): Promise<any[]> {
    const like = `%${text}%`;
    const { data } = await supabase
        .from('customers')
        .select('id, phones')
        .or(`firstName.ilike.${like},lastName.ilike.${like},email.ilike.${like}`)
        .limit(MAX_CLIENTS);
    return (data || []) as any[];
}

/**
 * Чем могут быть помечены звонки клиентов с таким названием.
 * Пусто — значит ни одной подходящей карточки не нашлось.
 */
export async function clientCallKeys(text: string): Promise<ClientCallKeys> {
    const [clients, people] = await Promise.all([findClients(text), findPeople(text)]);
    if (!clients.length && !people.length) {
        return { orderNumbers: [], customerIds: [], phones: [] };
    }

    const clientIds = clients.map((row) => String(row.id));

    // Контактные лица найденных компаний: звонок помечен человеком, а не фирмой.
    const contacts = clientIds.length
        ? ((await supabase
            .from('client_contacts')
            .select('contact_id')
            .in('client_id', clientIds)
            .limit(MAX_VALUES)).data || []) as any[]
        : [];

    // Заказы найденных клиентов: большинство звонков помечено номером заказа.
    const orders = clientIds.length
        ? ((await supabase
            .from('orders')
            .select('number')
            .in('customer->>id', clientIds)
            .not('number', 'is', null)
            .order('createdAt', { ascending: false })
            .limit(MAX_ORDERS)).data || []) as any[]
        : [];

    const phones = new Set<string>();
    for (const row of [...clients, ...people]) {
        for (const phone of (row.phones || [])) {
            const digits = normalizePhone(phone);
            if (digits.length >= 6) phones.add(digits);
        }
    }

    const customerIds = new Set<string>([
        ...clientIds,
        ...people.map((row) => String(row.id)),
        ...contacts.map((row) => String(row.contact_id)),
    ]);

    return {
        orderNumbers: Array.from(new Set(orders.map((row) => String(row.number)))).slice(0, MAX_VALUES),
        customerIds: Array.from(customerIds).slice(0, MAX_VALUES),
        phones: Array.from(phones).slice(0, MAX_VALUES),
    };
}
