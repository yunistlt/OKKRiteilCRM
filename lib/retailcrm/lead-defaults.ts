import { supabase } from '@/utils/supabase';

/**
 * Дефолты полей карточки заказа для лидов, которые заводят боты
 * (Катерина — почта, Елена — виджет/чат/корзина, AI-секретарь Телфина — звонок).
 *
 * Зачем: в CRM у заказа четыре обязательных кастом-поля (категория товара, сфера
 * деятельности, дата следующего контакта, срок изготовления) и два обязательных
 * у карточки клиента. Бот их не заполнял — менеджер не мог сохранить карточку,
 * пока не проставит всё руками.
 *
 * Коды полей и справочников — см. lib/retailcrm/NAMING.md (имена там сбивают с толку:
 * `typ_castomer` — это КАТЕГОРИЯ ТОВАРА, а не тип клиента).
 */

// --- Коды кастом-полей заказа ---
export const ORDER_FIELD_PRODUCT_CATEGORY = 'typ_castomer';        // Категория товара (обяз.)
export const ORDER_FIELD_ACTIVITY_SPHERE = 'sfera_deiatelnosti';   // Сфера деятельности (обяз.)
export const ORDER_FIELD_NEXT_CONTACT = 'data_kontakta';           // Дата следующего контакта (обяз.)
export const ORDER_FIELD_PRODUCTION_DAYS = 'srok_izgot';           // Срок изготовления в днях (обяз.)
export const ORDER_FIELD_PURCHASE_FORM = 'typ_customer_margin';    // Форма закупки

// --- Коды кастом-полей клиента (одинаковые у customer и customer_corporate, оба обязательные) ---
export const CUSTOMER_FIELD_PRODUCT_CATEGORY = 'kategoria_klienta';
export const CUSTOMER_FIELD_PURCHASE_FORM = 'kategoria_klienta_po_vidu';

// --- Справочники, на которые ссылаются эти поля ---
export const DICT_PRODUCT_CATEGORY = 'kategoriya_klienta';
export const DICT_ACTIVITY_SPHERE = 'sfera_deiatelnosti';
export const DICT_PURCHASE_FORM = 'type_customer';

/** Элемент «Требуется уточнить» — есть и активен во всех трёх справочниках. */
export const UNSPECIFIED_ITEM_CODE = 'trebuetsya-utochnit';

/** Срок изготовления по умолчанию: бот реального не знает, менеджер уточнит. */
export const DEFAULT_PRODUCTION_DAYS = 20;

/** Офис в Тольятти (UTC+4); сервер Vercel живёт в UTC. */
export const OFFICE_UTC_OFFSET_HOURS = 4;
/** Заявка после 17:00 по офису — контакт назначаем на завтра, сегодня уже не перезвонят. */
export const NEXT_CONTACT_CUTOFF_HOUR = 17;

/**
 * Дата следующего контакта в формате CRM (`YYYY-MM-DD`): сегодня,
 * а после 17:00 по Тольятти — завтра. Выходные намеренно не учитываем:
 * менеджер видит дату и правит, если работать в субботу не планирует.
 */
export function nextContactDate(now: Date = new Date()): string {
    const office = new Date(now.getTime() + OFFICE_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    if (office.getUTCHours() >= NEXT_CONTACT_CUTOFF_HOUR) {
        office.setUTCDate(office.getUTCDate() + 1);
    }
    return office.toISOString().slice(0, 10);
}

type DictItem = { code: string; name: string };

const DICTIONARY_CACHE_TTL_MS = 10 * 60 * 1000;
const dictionaryCache = new Map<string, { at: number; items: DictItem[] }>();

/**
 * Активные элементы справочника из локального зеркала RetailCRM.
 * ЗАКОН: неактивные элементы не предлагаем и не пишем.
 */
async function getActiveDictionaryItems(dictionaryCode: string): Promise<DictItem[]> {
    const cached = dictionaryCache.get(dictionaryCode);
    if (cached && Date.now() - cached.at < DICTIONARY_CACHE_TTL_MS) return cached.items;

    try {
        const { data, error } = await supabase
            .from('retailcrm_dictionaries')
            .select('item_code, item_name, active')
            .eq('entity_type', 'customField')
            .eq('dictionary_code', dictionaryCode);
        if (error) throw error;
        const items: DictItem[] = (data || [])
            .filter((row: any) => row.active !== false)
            .map((row: any) => ({ code: String(row.item_code), name: String(row.item_name || '') }));
        dictionaryCache.set(dictionaryCode, { at: Date.now(), items });
        return items;
    } catch (err) {
        console.error(`[lead-defaults] Не удалось прочитать справочник ${dictionaryCode}:`, err);
        return cached?.items || [];
    }
}

/**
 * Код элемента справочника: по подсказке (код или название — как бот его назвал),
 * иначе «Требуется уточнить». `null` — если справочник прочитать не удалось:
 * лучше оставить поле пустым, чем уронить создание заказа неизвестным кодом.
 */
export async function resolveDictionaryItemCode(
    dictionaryCode: string,
    hint?: string | null
): Promise<string | null> {
    const items = await getActiveDictionaryItems(dictionaryCode);
    if (items.length === 0) return null;

    const normalize = (value: string) => value.trim().toLowerCase();
    const hintValue = (hint || '').trim();
    if (hintValue) {
        const needle = normalize(hintValue);
        const match = items.find((item) => normalize(item.code) === needle)
            || items.find((item) => normalize(item.name) === needle);
        if (match) return match.code;
    }

    return items.find((item) => item.code === UNSPECIFIED_ITEM_CODE)?.code || null;
}

/** Человеческое название элемента «Требуется уточнить» — имя берём из CRM, не выдумываем. */
export async function unspecifiedLabel(dictionaryCode: string = DICT_PRODUCT_CATEGORY): Promise<string | null> {
    const items = await getActiveDictionaryItems(dictionaryCode);
    return items.find((item) => item.code === UNSPECIFIED_ITEM_CODE)?.name || null;
}

export type LeadFieldHints = {
    /** Категория товара — код или название элемента справочника, если бот его определил. */
    productCategory?: string | null;
    /** Сфера деятельности клиента. */
    activitySphere?: string | null;
    /** Форма закупки (себе / заказчику / тендер). */
    purchaseForm?: string | null;
    /** Срок изготовления в днях, если известен по заявке. */
    productionDays?: number | null;
    /** Точка отсчёта для даты следующего контакта (для тестов). */
    now?: Date;
};

/** Обязательные поля карточки заказа для лида от бота. */
export async function buildLeadOrderCustomFields(hints: LeadFieldHints = {}): Promise<Record<string, any>> {
    const [category, sphere, purchaseForm] = await Promise.all([
        resolveDictionaryItemCode(DICT_PRODUCT_CATEGORY, hints.productCategory),
        resolveDictionaryItemCode(DICT_ACTIVITY_SPHERE, hints.activitySphere),
        resolveDictionaryItemCode(DICT_PURCHASE_FORM, hints.purchaseForm),
    ]);

    const fields: Record<string, any> = {
        [ORDER_FIELD_NEXT_CONTACT]: nextContactDate(hints.now),
        [ORDER_FIELD_PRODUCTION_DAYS]: hints.productionDays ?? DEFAULT_PRODUCTION_DAYS,
    };
    if (category) fields[ORDER_FIELD_PRODUCT_CATEGORY] = category;
    if (sphere) fields[ORDER_FIELD_ACTIVITY_SPHERE] = sphere;
    if (purchaseForm) fields[ORDER_FIELD_PURCHASE_FORM] = purchaseForm;
    return fields;
}

/** Обязательные поля карточки клиента (обычного и корпоративного). */
export async function buildLeadCustomerCustomFields(hints: LeadFieldHints = {}): Promise<Record<string, any>> {
    const [category, purchaseForm] = await Promise.all([
        resolveDictionaryItemCode(DICT_PRODUCT_CATEGORY, hints.productCategory),
        resolveDictionaryItemCode(DICT_PURCHASE_FORM, hints.purchaseForm),
    ]);

    const fields: Record<string, any> = {};
    if (category) fields[CUSTOMER_FIELD_PRODUCT_CATEGORY] = category;
    if (purchaseForm) fields[CUSTOMER_FIELD_PURCHASE_FORM] = purchaseForm;
    return fields;
}
