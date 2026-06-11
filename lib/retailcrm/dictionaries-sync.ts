import { supabase } from '@/utils/supabase';

// ============================================================================
// Полный синк каталога RetailCRM:
//  1) пользовательские справочники (custom-fields/dictionaries) + поля (custom-fields)
//     по всем сущностям, активные и неактивные → retailcrm_dictionaries (customField) / retailcrm_custom_fields;
//  2) системные справочники reference/* (способы заказа, статусы, типы оплаты/доставки,
//     сайты, склады и т.п.) → retailcrm_dictionaries (entity_type = orderMethod/status/…).
// Закон: все человекочитаемые названия тянем из RetailCRM, не выдумываем.
// API v5: пользовательские методы — пагинация + limit 20/50/100/250; reference/* —
// объект-мапа без пагинации.
// ============================================================================

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY;
// Все сущности custom-fields в RetailCRM v5 (filter[entity]).
const ENTITIES = ['order', 'customer', 'customer_corporate', 'company', 'loyalty_account'] as const;

// Системные справочники reference/*: путь → ключ в ответе → entity_type в retailcrm_dictionaries.
const REFERENCES: { path: string; key: string; entityType: string }[] = [
    { path: 'order-methods', key: 'orderMethods', entityType: 'orderMethod' },
    { path: 'order-types', key: 'orderTypes', entityType: 'orderType' },
    { path: 'payment-types', key: 'paymentTypes', entityType: 'paymentType' },
    { path: 'delivery-types', key: 'deliveryTypes', entityType: 'deliveryType' },
    { path: 'statuses', key: 'statuses', entityType: 'status' },
    { path: 'status-groups', key: 'statusGroups', entityType: 'statusGroup' },
    { path: 'sites', key: 'sites', entityType: 'site' },
    { path: 'stores', key: 'stores', entityType: 'store' },
    { path: 'product-statuses', key: 'productStatuses', entityType: 'productStatus' },
];

export interface DictRow { entity_type: string; dictionary_code: string; item_code: string; item_name: string }
export interface RefRow { entity_type: string; item_code: string; item_name: string }
export interface FieldRow {
    entity: string; code: string; name: string | null; type: string | null; dictionary: string | null;
    ordering: number | null; in_filter: boolean | null; in_list: boolean | null; display_area: string | null; raw: any;
}
export interface CatalogData { dictionaryCount: number; dictRows: DictRow[]; fieldRows: FieldRow[]; refRows: RefRow[] }

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

    // 1. Все справочники со всеми значениями. Путь по докам RetailCRM v5:
    //    GET /api/v5/custom-fields/dictionaries (НЕ /custom-dictionaries).
    const dicts = await fetchAllPages(base, `/api/v5/custom-fields/dictionaries?apiKey=${key}`, 'customDictionaries');
    // entity_type='customField' — конвенция проекта для значений справочников
    // (см. lib/retailcrm/mapping.ts); upsert ложится поверх ранее синканных строк.
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

    // 3. Системные справочники reference/* (объект-мапа, без пагинации).
    const refRows: RefRow[] = [];
    for (const ref of REFERENCES) {
        let data: any;
        try {
            data = await getJson(`${base}/api/v5/reference/${ref.path}?apiKey=${key}`);
        } catch {
            continue; // справочник может быть недоступен (право/модуль) — пропускаем
        }
        const map = data[ref.key];
        if (!map || typeof map !== 'object') continue;
        for (const item of Object.values(map) as any[]) {
            if (item?.code == null) continue;
            refRows.push({ entity_type: ref.entityType, item_code: String(item.code), item_name: item.name ?? String(item.code) });
        }
    }

    // 4. Группы пользователей (роли) — пагинируемый метод; пишем как reference (entity_type=userGroup).
    try {
        const groups = await fetchAllPages(base, `/api/v5/user-groups?apiKey=${key}`, 'groups');
        for (const g of groups as any[]) {
            if (g?.code == null) continue;
            refRows.push({ entity_type: 'userGroup', item_code: String(g.code), item_name: g.name ?? String(g.code) });
        }
    } catch {
        // метод недоступен — пропускаем
    }

    return { dictionaryCount: dicts.length, dictRows, fieldRows, refRows };
}

/** Полный синк в БД через service-клиент (для API-эндпоинта). */
export async function syncRetailcrmCatalog(): Promise<{ dictionaries: number; dictionaryElements: number; customFields: number; referenceItems: number }> {
    const { dictionaryCount, dictRows, fieldRows, refRows } = await fetchRetailcrmCatalog();
    const now = new Date().toISOString();

    // Справочники кастом-полей (dictionary_code не null) — upsert по уникальному ключу.
    for (let i = 0; i < dictRows.length; i += 500) {
        const { error } = await supabase
            .from('retailcrm_dictionaries')
            .upsert(dictRows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })), { onConflict: 'entity_type,dictionary_code,item_code' });
        if (error) throw error;
    }
    // Определения полей.
    for (let i = 0; i < fieldRows.length; i += 500) {
        const { error } = await supabase
            .from('retailcrm_custom_fields')
            .upsert(fieldRows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })), { onConflict: 'entity,code' });
        if (error) throw error;
    }
    // Системные справочники: dictionary_code = NULL, а в Postgres NULL != NULL → upsert
    // по ключу не дедуплицирует. Поэтому полная замена: delete по entity_type + insert.
    const refEntities = Array.from(new Set(refRows.map((r) => r.entity_type)));
    for (const et of refEntities) {
        const { error: delErr } = await supabase.from('retailcrm_dictionaries').delete().eq('entity_type', et);
        if (delErr) throw delErr;
        const rows = refRows
            .filter((r) => r.entity_type === et)
            .map((r) => ({ entity_type: r.entity_type, dictionary_code: null, item_code: r.item_code, item_name: r.item_name, updated_at: now }));
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from('retailcrm_dictionaries').insert(rows.slice(i, i + 500));
            if (error) throw error;
        }
    }

    return { dictionaries: dictionaryCount, dictionaryElements: dictRows.length, customFields: fieldRows.length, referenceItems: refRows.length };
}
