import { supabase } from '@/utils/supabase';

// ============================================================================
// Полный синк каталога RetailCRM: ВСЕ пользовательские справочники (custom-
// dictionaries, со всеми значениями) + ВСЕ пользовательские поля (custom-fields)
// по всем сущностям (order/customer/customer_corporate), активные и неактивные.
// Значения справочников → retailcrm_dictionaries; определения полей (включая связь
// поле→справочник, напр. order.typ_castomer → kategoriya_klienta) → retailcrm_custom_fields.
// API v5: limit ДОЛЖЕН быть 20/50/100 (иначе 400).
// ============================================================================

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY;
const ENTITIES = ['order', 'customer', 'customer_corporate'] as const;

export interface DictRow { entity_type: string; dictionary_code: string; item_code: string; item_name: string }
export interface FieldRow {
    entity: string; code: string; name: string | null; type: string | null; dictionary: string | null;
    ordering: number | null; in_filter: boolean | null; in_list: boolean | null; display_area: string | null; raw: any;
}
export interface CatalogData { dictionaryCount: number; dictRows: DictRow[]; fieldRows: FieldRow[] }

export function isRetailcrmConfigured(): boolean {
    return !!(RETAILCRM_URL && RETAILCRM_KEY);
}

async function getJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RetailCRM HTTP ${res.status} (${url.replace(/apiKey=[^&]+/, 'apiKey=***')})`);
    const data = await res.json();
    if (!data.success) throw new Error(`RetailCRM success=false: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
}

async function fetchAllPages(base: string, pathWithQuery: string, listKey: string): Promise<any[]> {
    const out: any[] = [];
    let page = 1;
    let totalPages = 1;
    do {
        const sep = pathWithQuery.includes('?') ? '&' : '?';
        const data = await getJson(`${base}${pathWithQuery}${sep}limit=100&page=${page}`);
        out.push(...(data[listKey] ?? []));
        totalPages = data.pagination?.totalPageCount ?? 1;
        page++;
    } while (page <= totalPages);
    return out;
}

/** Тянет каталог из RetailCRM (без записи в БД) — переиспользуется эндпоинтом и CLI-скриптом. */
export async function fetchRetailcrmCatalog(): Promise<CatalogData> {
    if (!isRetailcrmConfigured()) throw new Error('RetailCRM не сконфигурирован (RETAILCRM_URL/RETAILCRM_API_KEY)');
    const base = RETAILCRM_URL!.replace(/\/+$/, '');
    const key = encodeURIComponent(RETAILCRM_KEY!);

    // 1. Все справочники со всеми значениями
    const dicts = await fetchAllPages(base, `/api/v5/custom-dictionaries?apiKey=${key}`, 'customDictionaries');
    // entity_type='customField' — конвенция проекта для значений справочников
    // (см. lib/retailcrm-mapping.ts); upsert ложится поверх ранее синканных строк.
    const dictRows: DictRow[] = [];
    for (const d of dicts) {
        for (const el of d.elements ?? []) {
            if (el?.code == null) continue;
            dictRows.push({ entity_type: 'customField', dictionary_code: d.code, item_code: String(el.code), item_name: el.name ?? String(el.code) });
        }
    }

    // 2. Все поля по всем сущностям
    const fieldRows: FieldRow[] = [];
    for (const entity of ENTITIES) {
        const fields = await fetchAllPages(base, `/api/v5/custom-fields?apiKey=${key}&filter[entity]=${entity}`, 'customFields');
        for (const f of fields) {
            if (f?.code == null) continue;
            fieldRows.push({
                entity: f.entity ?? entity,
                code: String(f.code),
                name: f.name ?? null,
                type: f.type ?? null,
                dictionary: f.dictionary ?? null,
                ordering: f.ordering ?? null,
                in_filter: f.inFilter ?? null,
                in_list: f.inList ?? null,
                display_area: f.displayArea ?? null,
                raw: f,
            });
        }
    }

    return { dictionaryCount: dicts.length, dictRows, fieldRows };
}

/** Полный синк в БД через service-клиент (для API-эндпоинта). */
export async function syncRetailcrmCatalog(): Promise<{ dictionaries: number; dictionaryElements: number; customFields: number }> {
    const { dictionaryCount, dictRows, fieldRows } = await fetchRetailcrmCatalog();
    const now = new Date().toISOString();

    for (let i = 0; i < dictRows.length; i += 500) {
        const { error } = await supabase
            .from('retailcrm_dictionaries')
            .upsert(dictRows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })), { onConflict: 'entity_type,dictionary_code,item_code' });
        if (error) throw error;
    }
    for (let i = 0; i < fieldRows.length; i += 500) {
        const { error } = await supabase
            .from('retailcrm_custom_fields')
            .upsert(fieldRows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })), { onConflict: 'entity,code' });
        if (error) throw error;
    }

    return { dictionaries: dictionaryCount, dictionaryElements: dictRows.length, customFields: fieldRows.length };
}
