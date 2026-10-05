/**
 * Синхронизация контактных лиц RetailCRM.
 *
 * В RetailCRM клиент — это две сущности: юрлицо и контактное лицо. Телефоны и
 * почта живут у контакта, поэтому без этой синхронизации в карточках клиентов
 * не было ни одного телефона (проверено 30.09.2026 на 20 699 карточках).
 *
 * Инкремент по дате изменения: за один проход берём свежие, полный проход
 * делается скриптом `scripts/customers-sync.mjs`.
 *
 * **Правленных в ОКК не затираем.** С 02.10.2026 ФИО, телефоны и почту
 * человека менеджер правит у нас и в RetailCRM это не уезжает, поэтому у таких
 * строк (метка `customers.okk_edited_at`) синхронизация обновляет только то,
 * что считает CRM — заказы, суммы, сегменты, сырой ответ, — а личные поля
 * оставляет нашими.
 */
import { supabase } from '@/utils/supabase';
import { getCrmConfig } from './leads';
import { personsEditedInOkk } from '@/lib/own-crm/client-people';

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

        /**
         * Берём из RetailCRM только то, чего у нас ещё нет.
         *
         * Закон владельца 05.10.2026: «мы уже ничего не синхронизируем с
         * ритейлом, если только надо что-то докачать». Работа идёт в ОКК, и
         * обновления оттуда затирали бы наши данные — например, возвращали бы
         * в карточку почту робота. Поэтому новые карточки заводим, а
         * существующие не трогаем вовсе.
         */
        const { data: known } = await supabase
            .from('customers')
            .select('id')
            .in('id', rows.map((customer: any) => customer.id));
        const haveIds = new Set(((known ?? []) as any[]).map((row) => Number(row.id)));
        const fresh = rows.filter((customer: any) => !haveIds.has(Number(customer.id)));

        // Кого из этой партии правили у нас — их личные поля не перезаписываем.
        const editedHere = await personsEditedInOkk(fresh.map((customer: any) => customer.id));

        const common = (customer: any) => ({
            id: customer.id,
            externalId: customer.externalId ?? null,
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
        });

        const personal = (customer: any) => ({
            firstName: customer.firstName ?? null,
            lastName: customer.lastName ?? null,
            patronymic: customer.patronymic ?? null,
            email: customer.email ?? null,
            phones: phonesOf(customer),
        });

        // Два вызова, а не один: PostgREST обновляет ровно те колонки, что
        // переданы, и набор колонок в партии должен быть одинаковым.
        const untouched = fresh.filter((customer: any) => !editedHere.has(Number(customer.id)));
        const ours = fresh.filter((customer: any) => editedHere.has(Number(customer.id)));

        if (untouched.length) {
            await supabase.from('customers').upsert(
                untouched.map((customer: any) => ({ ...common(customer), ...personal(customer) })),
                { onConflict: 'id' },
            );
        }
        if (ours.length) {
            await supabase.from('customers').upsert(ours.map(common), { onConflict: 'id' });
        }

        fetched += fresh.length;
        if (page >= (payload.pagination?.totalPageCount || 1)) {
            break;
        }
    }

    // Кто из контактов относится к какому клиенту — по заказам.
    const { data: links } = await supabase.rpc('refresh_client_contacts');

    return { fetched, links: Number(links) || 0 };
}
