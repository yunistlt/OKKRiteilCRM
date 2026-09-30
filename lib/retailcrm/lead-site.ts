/**
 * Выбор магазина RetailCRM для заявок с почты — с проверкой и запасным.
 *
 * Зачем: 30.09.2026 RetailCRM перестала принимать магазин `zmktlt-ru` на
 * создание заказов, и заявки с почты перестали заводиться. Код был исправен,
 * но узнали мы об этом от менеджеров спустя четыре часа.
 *
 * Теперь перед созданием заказа магазин сверяется с нашим справочником
 * (`retailcrm_dictionaries`, он синхронизируется с RetailCRM и хранит признак
 * активности). Пропал — переходим на запасной и сообщаем владельцу.
 */
import { supabase } from '@/utils/supabase';
import { sendNotification } from '@/lib/notify/send';

export type LeadSiteChoice = {
    /** Магазин, с которым создаём заказ. */
    site: string;
    /** Магазин, который был настроен. */
    configured: string | null;
    /** Правда, если настроенный магазин недоступен и мы взяли запасной. */
    substituted: boolean;
    /** Человеческое объяснение — идёт в разбор письма и в уведомление. */
    reason: string | null;
};

async function activeSites(): Promise<Map<string, string>> {
    const { data } = await supabase
        .from('retailcrm_dictionaries')
        .select('item_code, item_name, active')
        .eq('entity_type', 'site');

    const sites = new Map<string, string>();
    for (const row of (data || []) as any[]) {
        if (row.active !== false) {
            sites.set(String(row.item_code), String(row.item_name || row.item_code));
        }
    }
    return sites;
}

/**
 * Какой магазин использовать для заявки с почты.
 *
 * Порядок: настройка в базе → переменная окружения → запасной из настройки →
 * первый действующий магазин из справочника.
 */
export async function resolveLeadSite(): Promise<LeadSiteChoice> {
    const { data: cfg } = await supabase
        .from('email_intake_config')
        .select('lead_site, lead_site_fallback')
        .maybeSingle();

    const configured = (cfg as any)?.lead_site || process.env.RETAILCRM_SITE || null;
    const fallback = (cfg as any)?.lead_site_fallback || null;
    const sites = await activeSites();

    // Справочник пуст (синхронизация ещё не проходила) — не выдумываем, идём как настроено.
    if (!sites.size || !configured) {
        return { site: configured || '', configured, substituted: false, reason: null };
    }

    if (sites.has(configured)) {
        return { site: configured, configured, substituted: false, reason: null };
    }

    const replacement = (fallback && sites.has(fallback)) ? fallback : Array.from(sites.keys())[0];
    if (!replacement) {
        return { site: configured, configured, substituted: false, reason: null };
    }

    const reason = `Магазин «${configured}» пропал из справочника RetailCRM — заявки заводим в «${sites.get(replacement)}» (${replacement})`;
    return { site: replacement, configured, substituted: true, reason };
}

/** Сообщить владельцу о подмене. Не чаще раза в сутки — чтобы не спамить. */
export async function reportSiteSubstitution(choice: LeadSiteChoice): Promise<void> {
    if (!choice.substituted || !choice.reason) {
        return;
    }

    const key = 'lead_site_alert_at';
    const { data: state } = await supabase.from('sync_state').select('value').eq('key', key).maybeSingle();
    const lastAt = (state as any)?.value ? new Date(String((state as any).value)).getTime() : 0;
    if (Date.now() - lastAt < 24 * 60 * 60 * 1000) {
        return;
    }

    await sendNotification(
        'system.crm_site_missing',
        `<b>Магазин заявок недоступен в RetailCRM</b>\n\n${choice.reason}\n\n` +
        `Заявки с почты продолжают заводиться, но в другом магазине. ` +
        `Проверьте магазин «${choice.configured}» в RetailCRM: активен ли он и открыт ли для нашего ключа.`,
    );

    await supabase.from('sync_state').upsert([{ key, value: new Date().toISOString() }], { onConflict: 'key' });
}
