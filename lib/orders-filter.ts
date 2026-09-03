/**
 * Фильтры списка заказов — перенос панели RetailCRM.
 *
 * Поля и их порядок повторяют их экран «Заказы», чтобы менеджер не переучивался.
 * Коды пользовательских полей взяты из справочника `retailcrm_custom_fields`, не выдуманы:
 *   Категория товара*            → typ_castomer
 *   Сфера деятельности*          → sfera_deiatelnosti
 *   КОНТРОЛЬ                     → control (да/нет)
 *   Дата следующего контакта     → data_kontakta
 *   В каком месяце закупка       → kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty
 */

export const CUSTOM_FIELD_CODES = {
    category: 'typ_castomer',
    sfera: 'sfera_deiatelnosti',
    control: 'control',
    nextContact: 'data_kontakta',
    purchaseMonth: 'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty',
} as const;

export interface OrdersFilter {
    number: string;
    customer: string;
    managers: string[];
    statuses: string[];
    marks: string[];              // vip, bad
    sumFrom: string;
    sumTo: string;
    categories: string[];
    control: string;              // '', 'yes', 'no'
    contactFrom: string;
    contactTo: string;
    createdFrom: string;
    createdTo: string;
    contragent: string;
    sferas: string[];
    purchaseFrom: string;
    purchaseTo: string;
    managerComment: string;
    customerComment: string;
}

export const EMPTY_FILTER: OrdersFilter = {
    number: '', customer: '', managers: [], statuses: [], marks: [],
    sumFrom: '', sumTo: '', categories: [], control: '',
    contactFrom: '', contactTo: '', createdFrom: '', createdTo: '',
    contragent: '', sferas: [], purchaseFrom: '', purchaseTo: '',
    managerComment: '', customerComment: '',
};

/** Запятые и скобки ломают синтаксис `or` в PostgREST — вычищаем их из пользовательского ввода. */
function safe(value: string): string {
    return value.replace(/[,()]/g, ' ').trim();
}

export function filterToSearchParams(filter: OrdersFilter): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
        if (Array.isArray(value)) {
            if (value.length) params.set(key, value.join(','));
        } else if (value) {
            params.set(key, String(value));
        }
    }
    return params;
}

export function parseOrdersFilter(searchParams: URLSearchParams): OrdersFilter {
    const list = (key: string) => (searchParams.get(key) || '').split(',').filter(Boolean);
    const text = (key: string) => searchParams.get(key) || '';

    return {
        number: text('number'),
        customer: text('customer'),
        managers: list('managers').length ? list('managers') : list('manager'),
        statuses: list('statuses').length ? list('statuses') : list('status'),
        marks: list('marks'),
        sumFrom: text('sumFrom'),
        sumTo: text('sumTo'),
        categories: list('categories'),
        control: text('control'),
        contactFrom: text('contactFrom'),
        contactTo: text('contactTo'),
        createdFrom: text('createdFrom'),
        createdTo: text('createdTo'),
        contragent: text('contragent'),
        sferas: list('sferas'),
        purchaseFrom: text('purchaseFrom'),
        purchaseTo: text('purchaseTo'),
        managerComment: text('managerComment'),
        customerComment: text('customerComment'),
    };
}

const cf = (code: string) => `raw_payload->customFields->>${code}`;

/** Навешивает условия фильтра на запрос к orders. */
export function applyOrdersFilter(query: any, filter: OrdersFilter) {
    let q = query;

    if (filter.number) q = q.ilike('number', `%${safe(filter.number)}%`);

    if (filter.customer) {
        const v = safe(filter.customer);
        q = q.or(
            [
                `raw_payload->>firstName.ilike.%${v}%`,
                `raw_payload->>lastName.ilike.%${v}%`,
                `raw_payload->>email.ilike.%${v}%`,
                `phone.ilike.%${v}%`,
            ].join(',')
        );
    }

    if (filter.statuses.length) q = q.in('status', filter.statuses);

    if (filter.managers.length) {
        const ids = filter.managers.map((m) => parseInt(m, 10)).filter((n) => !Number.isNaN(n));
        if (ids.length) q = q.in('manager_id', ids);
    }

    if (filter.marks.includes('vip')) q = q.eq('raw_payload->customer->>vip', 'true');
    if (filter.marks.includes('bad')) q = q.eq('raw_payload->customer->>bad', 'true');

    if (filter.sumFrom) q = q.gte('totalsumm', Number(filter.sumFrom));
    if (filter.sumTo) q = q.lte('totalsumm', Number(filter.sumTo));

    if (filter.categories.length) q = q.in(cf(CUSTOM_FIELD_CODES.category), filter.categories);
    if (filter.sferas.length) q = q.in(cf(CUSTOM_FIELD_CODES.sfera), filter.sferas);

    if (filter.control === 'yes') q = q.eq(cf(CUSTOM_FIELD_CODES.control), 'true');
    if (filter.control === 'no') q = q.eq(cf(CUSTOM_FIELD_CODES.control), 'false');

    if (filter.contactFrom) q = q.gte(cf(CUSTOM_FIELD_CODES.nextContact), filter.contactFrom);
    if (filter.contactTo) q = q.lte(cf(CUSTOM_FIELD_CODES.nextContact), filter.contactTo);

    if (filter.purchaseFrom) q = q.gte(cf(CUSTOM_FIELD_CODES.purchaseMonth), filter.purchaseFrom);
    if (filter.purchaseTo) q = q.lte(cf(CUSTOM_FIELD_CODES.purchaseMonth), filter.purchaseTo);

    if (filter.createdFrom) q = q.gte('created_at', filter.createdFrom);
    if (filter.createdTo) q = q.lte('created_at', `${filter.createdTo}T23:59:59`);

    if (filter.contragent) q = q.ilike('raw_payload->contragent->>legalName', `%${safe(filter.contragent)}%`);
    if (filter.managerComment) q = q.ilike('raw_payload->>managerComment', `%${safe(filter.managerComment)}%`);
    if (filter.customerComment) q = q.ilike('raw_payload->>customerComment', `%${safe(filter.customerComment)}%`);

    return q;
}

/** Есть ли хоть одно заполненное условие — для подсветки кнопки сброса. */
export function isFilterEmpty(filter: OrdersFilter): boolean {
    return Object.values(filter).every((v) => (Array.isArray(v) ? v.length === 0 : !v));
}
