/**
 * Синхронизация контактных лиц RetailCRM.
 *
 * В RetailCRM клиент — это две сущности: юрлицо и контактное лицо. Телефоны и
 * почта живут у контакта, поэтому без этой синхронизации в карточках клиентов
 * не было ни одного телефона (проверено 30.09.2026 на 20 699 карточках).
 *
 * Инкремент по дате изменения: за один проход берём свежие, полный проход
 * делается скриптом `scripts/customers-sync.mjs`.
 */
import { supabase } from '@/utils/supabase';
import { getCrmConfig } from './leads';

export type CustomersSyncResult = { fetched: number; links: number };

function phonesOf(customer: any): string[] {
    return (customer.phones || [])
        .map((phone: any) => String(phone.number || '').replace(/[^\d+]/g, ''))
        .filter(Boolean);
}

/** Забрать контакты, изменённые с указанной даты. */
export async function syncCustomers(sinceIso: string, maxPages = 10): Promise<CustomersSyncResult> {
    const { url, key } = await getCrmConfig();
    // RetailCRM ждёт дату в виде «ГГГГ-ММ-ДД ЧЧ:ММ:СС».
    const since = sinceIso.replace('T', ' ').slice(0, 19);

    let fetched = 0;
    for (let page = 1; page <= maxPages; page++) {
        const response = await fetch(
            `${url}/api/v5/customers?apiKey=${key}&limit=100&page=${page}&filter[dateFrom]=${encodeURIComponent(since)}`,
        );
        if (!response.ok) {
            break;
        }

        const payload = await response.json();
        const rows = payload.customers || [];
        if (!rows.length) {
            break;
        }

        await supabase.from('customers').upsert(
            rows.map((customer: any) => ({
                id: customer.id,
                externalId: customer.externalId ?? null,
                firstName: customer.firstName ?? null,
                lastName: customer.lastName ?? null,
                patronymic: customer.patronymic ?? null,
                email: customer.email ?? null,
                phones: phonesOf(customer),
                site: customer.site ?? null,
                managerId: customer.managerId ?? null,
                vip: customer.vip ?? null,
                bad: customer.bad ?? null,
                isContact: customer.isContact ?? null,
                createdAt: customer.createdAt ?? null,
                ordersCount: customer.ordersCount ?? null,
                totalSumm: customer.totalSumm ?? null,
                averageSumm: customer.averageSumm ?? null,
                personalDiscount: customer.personalDiscount ?? null,
                segments: customer.segments ?? [],
                customFields: customer.customFields ?? {},
                raw: customer,
                updated_at: new Date().toISOString(),
            })),
            { onConflict: 'id' },
        );

        fetched += rows.length;
        if (page >= (payload.pagination?.totalPageCount || 1)) {
            break;
        }
    }

    // Кто из контактов относится к какому клиенту — по заказам.
    const { data: links } = await supabase.rpc('refresh_client_contacts');

    return { fetched, links: Number(links) || 0 };
}
