import { supabase } from '@/utils/supabase';
import { companyByInn, isDadataConfigured } from '@/lib/sales-rop/dadata';

/**
 * Кто эти клиенты на самом деле.
 *
 * В базе клиент — это название и ИНН. Кто он: завод, стройка или перекупщик,
 * одна площадка или двадцать филиалов, жив ли вообще — из наших данных не
 * видно. А это и есть разница между «позвонить обязательно» и «можно потом».
 *
 * Спрашиваем Dadata по ИНН. Бесплатный тариф даёт отрасль, регион, филиалы и
 * статус; выручку и штат не даёт — на них ничего не строим.
 *
 * Ходим маленькими пачками: 5 084 клиента разом не нужны никому, а дневной
 * лимит подсказок один на всю компанию, и делить его с другими задачами надо
 * бережно.
 */

export type EnrichResult = { checked: number; updated: number; dead: number; skipped: boolean };

/** Клиент, которого давно не проверяли: реквизиты компаний меняются. */
const RECHECK_DAYS = 180;

export async function enrichClients(limit = 200): Promise<EnrichResult> {
    if (!isDadataConfigured()) return { checked: 0, updated: 0, dead: 0, skipped: true };

    const stale = new Date(Date.now() - RECHECK_DAYS * 24 * 3600_000).toISOString();
    const { data, error } = await supabase
        .from('sales_client_relation')
        .select('client_key, inn, enriched_at')
        .not('inn', 'is', null)
        .or(`enriched_at.is.null,enriched_at.lt.${stale}`)
        // Сначала те, кто дороже: если лимит кончится, он кончится на мелких.
        .order('total_summ', { ascending: false })
        .limit(limit);
    if (error || !data?.length) return { checked: 0, updated: 0, dead: 0, skipped: false };

    let updated = 0;
    let dead = 0;

    for (const row of data as any[]) {
        const inn = String(row.inn).trim();
        if (!/^\d{10}(\d{2})?$/.test(inn)) {
            // Мусор в поле ИНН: помечаем проверенным, чтобы не спрашивать вечно.
            await supabase
                .from('sales_client_relation')
                .update({ enriched_at: new Date().toISOString() })
                .eq('client_key', row.client_key);
            continue;
        }

        const info = await companyByInn(inn).catch(() => null);
        if (!info) {
            await supabase
                .from('sales_client_relation')
                .update({ enriched_at: new Date().toISOString() })
                .eq('client_key', row.client_key);
            continue;
        }

        if (!info.alive) dead += 1;
        const { error: upErr } = await supabase
            .from('sales_client_relation')
            .update({
                okved_code: info.activityCode,
                activity: info.activity,
                region: info.region,
                branches: info.branches,
                company_alive: info.alive,
                company_status: info.status,
                // Приезжают только на тарифе, который их отдаёт. Пустые
                // перезаписывать пустыми не страшно: логика их и не ждёт.
                employees: info.employees,
                revenue: info.revenue,
                revenue_year: info.revenueYear,
                enriched_at: new Date().toISOString(),
            })
            .eq('client_key', row.client_key);
        if (!upErr) updated += 1;
    }

    return { checked: data.length, updated, dead, skipped: false };
}
