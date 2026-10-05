/**
 * Разовая дотяжка карточек клиентов, которых нет в нашем зеркале.
 *
 * Повод (05.10.2026): у 922 заказов за год `raw_payload.customer.id` ссылается
 * на карточку, которой у нас нет, — кнопки «карточка заказчика» и «править в
 * карточке клиента» отвечают «Клиент не найден» (жалоба Евгении по заказу
 * 900024). Дыру оставил инкрементальный синк: он продолжает от максимального
 * `created_at` в `clients`, поэтому карточку, заведённую в RetailCRM задним
 * числом, не забирает уже никогда.
 *
 * Читаем RetailCRM и пишем только к себе: в их базу эта работа ничего не шлёт
 * (решение владельца 05.10.2026 — RetailCRM остаётся базой данных на чтение).
 *
 * Запуск:  npx tsx scripts/backfill-missing-clients.ts [--apply] [--days=400]
 * Без --apply только показывает, что нашёл.
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

import { supabase } from '@/utils/supabase';

const APPLY = process.argv.includes('--apply');
const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=400').split('=')[1]);

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY || '';

function cleanPhone(value: any): string {
    return value ? String(value).replace(/[^\d+]/g, '') : '';
}

/** Чьих карточек не хватает: ищем по заказам, ссылающимся в пустоту. */
async function missingIds(): Promise<number[]> {
    const { data, error } = await supabase.rpc('shtab_run_readonly_query', {
        p_sql: `select distinct (o.raw_payload->'customer'->>'id')::bigint as id
                from orders o
                left join clients c on c.id = (o.raw_payload->'customer'->>'id')::bigint
                where o."createdAt" >= now() - interval '${DAYS} days'
                  and o.raw_payload->'customer'->>'id' is not null
                  and c.id is null
                order by 1`,
    });
    if (error) throw new Error(`Не смог собрать список: ${error.message}`);
    return (data as any[]).map((row) => Number(row.id)).filter(Boolean);
}

/** Карточки юрлиц из RetailCRM по их номерам, партиями по 50. */
async function fetchCorporate(ids: number[]): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; from < ids.length; from += 50) {
        const chunk = ids.slice(from, from + 50);
        const params = new URLSearchParams({ apiKey: RETAILCRM_API_KEY, limit: '100', page: '1' });
        chunk.forEach((id) => params.append('filter[ids][]', String(id)));

        const res = await fetch(`${RETAILCRM_URL}/api/v5/customers-corporate?${params.toString()}`);
        if (!res.ok) throw new Error(`RetailCRM ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);

        const payload = await res.json();
        out.push(...(payload.customersCorporate || []));
        process.stdout.write(`\rзабрано ${out.length} из ${ids.length}`);
    }
    process.stdout.write('\n');
    return out;
}

/** Та же раскладка полей, что и в обычном синке юрлиц (app/api/sync/retailcrm/clients). */
function toClientRow(c: any) {
    const phones = new Set<string>();
    (c.phones || []).forEach((p: any) => { const v = cleanPhone(p.number); if (v) phones.add(v); });
    const mainContact = c.mainCustomerContact || (c.contactPersons && c.contactPersons[0]);

    return {
        id: c.id,
        external_id: c.externalId || null,
        first_name: null,
        last_name: null,
        patronymic: null,
        phones: Array.from(phones),
        email: c.email || null,
        created_at: c.createdAt,
        updated_at: c.updatedAt || new Date().toISOString(),
        address: c.mainAddress || (c.addresses ? c.addresses[0] : null),
        custom_fields: c.customFields || {},
        manager_id: c.managerId ? String(c.managerId) : null,
        site: c.site || null,
        vip: c.vip || false,
        bad: c.bad || false,
        personal_discount: c.personalDiscount || 0,
        cumulative_discount: c.cumulativeDiscount || 0,
        source: c.source?.source || null,
        company_name: c.nickName || c.legalName || null,
        inn: c.contragent?.inn || null,
        kpp: c.contragent?.kpp || null,
        contragent_type: c.contragent?.contragentType || null,
        orders_count: c.ordersCount || 0,
        total_summ: c.totalSumm || 0,
        average_check: c.averageSumm || 0,
        contact_name: mainContact ? `${mainContact.firstName ?? ''} ${mainContact.lastName ?? ''}`.trim() || null : null,
        contact_email: mainContact?.email || null,
        main_contact_id: mainContact?.customer?.id || mainContact?.id || null,
        is_corporate: true,
    };
}

(async () => {
    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) throw new Error('Нет доступа к RetailCRM в окружении');

    const ids = await missingIds();
    console.log(`Карточек не хватает: ${ids.length} (за ${DAYS} дней)`);
    if (!ids.length) return;

    const found = await fetchCorporate(ids);
    const foundIds = new Set(found.map((c: any) => Number(c.id)));
    const notFound = ids.filter((id) => !foundIds.has(id));
    console.log(`Нашлось в RetailCRM: ${found.length}; нет и там: ${notFound.length}`);
    if (notFound.length) console.log('Нет в RetailCRM:', notFound.join(', '));

    const sample = found.slice(0, 5).map(toClientRow);
    console.log('Примеры:', sample.map((r) => `${r.id} ${r.company_name || r.contact_name || '—'} ИНН ${r.inn || '—'}`).join(' | '));

    if (!APPLY) {
        console.log('Это примерка. Чтобы записать, запустите с --apply');
        return;
    }

    // Пишем теми же воротами, что и обычный синк, партиями по 100.
    let saved = 0;
    const rows = found.map(toClientRow);
    for (let from = 0; from < rows.length; from += 100) {
        const chunk = rows.slice(from, from + 100);
        const { error } = await supabase.rpc('upsert_clients', { clients_data: chunk });
        if (error) throw new Error(`Запись не прошла на партии ${from}: ${error.message}`);
        saved += chunk.length;
        process.stdout.write(`\rзаписано ${saved} из ${rows.length}`);
    }
    process.stdout.write('\n');
    console.log('Готово. Записано карточек:', saved);
})();
