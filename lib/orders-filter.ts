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
import { resolveDate } from './relative-date';

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
    /**
     * Наименование товара в составе заказа. Просьба Евгении Матвеевой
     * 06.10.2026: без него не найти дубль заявки по одному и тому же изделию.
     */
    itemName: string;
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
    /** Только заказы, выбившиеся из норматива времени в статусе. */
    overdueOnly: boolean;
    /**
     * Только возможные дубли: у клиента есть другой незакрытый заказ рядом по
     * времени (жалоба Ирины Гордеевой 06.10.2026 — «не найти дубли заказов»).
     */
    duplicatesOnly: boolean;
    /**
     * Номера заказов-кандидатов. Считает их база (`orders_duplicate_ids`), а
     * маршрут списка подставляет сюда: условие «у клиента есть второй заказ»
     * одним запросом к таблице не выражается.
     */
    duplicateIds?: string[];
    /**
     * Поля карточки заказа: код дополнительного поля → что ищем. Человек
     * включает их шестерёнкой фильтра (решение владельца 05.10.2026).
     */
    customFields?: Record<string, string>;
    /**
     * Карточки клиентов, подошедшие под поле «Покупатель». Заполняет маршрут
     * списка перед запросом (`clientIdsByText`): искать заказы по клиенту одним
     * запросом нельзя — карточки лежат в своих таблицах.
     */
    customerIds?: string[];
}

export const EMPTY_FILTER: OrdersFilter = {
    number: '', customer: '', itemName: '', managers: [], statuses: [], marks: [],
    sumFrom: '', sumTo: '', categories: [], control: '',
    contactFrom: '', contactTo: '', createdFrom: '', createdTo: '',
    contragent: '', sferas: [], purchaseFrom: '', purchaseTo: '',
    managerComment: '', customerComment: '', overdueOnly: false, duplicatesOnly: false,
    customFields: {},
};

/**
 * Последние десять цифр телефона — то, что не зависит от записи номера: «8»
 * и «+7» в начале у одного и того же номера разные, дальше всё совпадает.
 * Не похоже на телефон — возвращаем пустую строку.
 */
export function phoneTail(value: string): string {
    const digits = String(value ?? '').replace(/\D+/g, '');
    return digits.length >= 10 ? digits.slice(-10) : '';
}

/** Запятые и скобки ломают синтаксис `or` в PostgREST — вычищаем их из пользовательского ввода. */
function safe(value: string): string {
    return value.replace(/[,()]/g, ' ').trim();
}

export function filterToSearchParams(filter: OrdersFilter): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
        // Поля карточки едут как `cf.<код>=значение`: так они переживают
        // ссылку, сохранённый фильтр и перезагрузку страницы.
        if (key === 'customFields') {
            for (const [code, text] of Object.entries((value ?? {}) as Record<string, string>)) {
                if (text) params.set(`cf.${code}`, String(text));
            }
            continue;
        }
        if (Array.isArray(value)) {
            if (value.length) params.set(key, value.join(','));
        } else if (typeof value === 'boolean') {
            if (value) params.set(key, 'true');
        } else if (value) {
            params.set(key, String(value));
        }
    }
    return params;
}

export function parseOrdersFilter(searchParams: URLSearchParams): OrdersFilter {
    const list = (key: string) => (searchParams.get(key) || '').split(',').filter(Boolean);
    const text = (key: string) => searchParams.get(key) || '';

    const customFields: Record<string, string> = {};
    searchParams.forEach((value: string, key: string) => {
        if (key.startsWith('cf.') && value) customFields[key.slice(3)] = value;
    });

    return {
        customFields,
        number: text('number'),
        customer: text('customer'),
        itemName: text('itemName'),
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
        overdueOnly: text('overdueOnly') === 'true',
        duplicatesOnly: text('duplicatesOnly') === 'true',
    };
}

const cf = (code: string) => `raw_payload->customFields->>${code}`;

/**
 * Колонки заказа под фильтр — те же имена, что у RetailCRM (миграция
 * 20260928_orders_retailcrm_columns.sql).
 *
 * Через JSON фильтр по дате молча не работал: PostgREST отказывался сравнивать
 * `raw_payload->customFields->>data_kontakta` через gte/lte, запрос падал с
 * пустой ошибкой, и список оставался прежним (поймано 02.10.2026). Колонки
 * типизированы (date, boolean) — сравнение честное и по индексу.
 */
const COLUMNS = {
    nextContact: 'data_kontakta',
    // Имя Postgres укоротил до 63 знаков — так и лежит в базе.
    purchaseMonth: 'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_dat',
    category: 'typ_castomer',
    sfera: 'sfera_deiatelnosti',
    control: 'control',
} as const;

/**
 * Образец для поиска по названию товара: знаки препинания — подстановками.
 *
 * «Стеллаж СТ-15» и «Стеллаж СТ–15» должны находиться одним запросом, как и в
 * поиске по каталогу (решение владельца 06.10.2026).
 */
export function itemNamePattern(text: string): string {
    return String(text ?? '')
        .trim()
        .replace(/[\\%]/g, (ch) => `\\${ch}`)
        .replace(/[^a-zа-яё0-9\\%]+/gi, '%');
}

/** Навешивает условия фильтра на запрос к orders. */
export function applyOrdersFilter(query: any, filter: OrdersFilter) {
    let q = query;

    if (filter.number) q = q.ilike('number', `%${safe(filter.number)}%`);

    if (filter.customer) {
        const v = safe(filter.customer);
        /**
         * Ищем ТОЛЬКО по полям заказа, не по снимку.
         *
         * Жалоба Ксении 07.10.2026: «фильтр работает отвратительно, по 10–15
         * раз нажимать приходится, сильно лагает». Это была моя регрессия: я
         * добавил в условие чтение снимка (`raw_payload->>…`) — разбор JSON в
         * каждой из 30 тысяч строк без индексов, запрос не укладывался в
         * таймаут. Менеджер видел «заказов нет» вместо найденного заказа.
         *
         * У каждого поля здесь есть индекс для поиска по куску слова
         * (migrations/20261007_orders_search_indexes.sql).
         */
        const conditions = [
            // Одно поле вместо семи: по одному полю поиск 121 мс, те же данные
            // через ИЛИ по семи — 2 061 мс (замер на боевой базе 07.10.2026).
            `search_text.ilike.%${v.toLowerCase()}%`,
        ];

        /**
         * Клиент ищется и по своей карточке, а не только по контакту заказа:
         * заказ может стоять на человеке, а карточка называться иначе
         * («Лачинов Вугар» против контакта «Александр Дубровский»).
         */
        if (filter.customerIds?.length) {
            conditions.push(`raw_payload->customer->>id.in.(${filter.customerIds.join(',')})`);
        }

        /**
         * Телефон ищем по последним десяти цифрам. В базе он лежит слитно
         * («79953446862»), а человек набирает как привык — «8 995 344-68-62»,
         * «+7 (995) 344-68-62» — и поиск молча не находил ничего (Елена
         * Парфёнова 05.10.2026).
         */
        // Телефон по последним цифрам: в поисковой строке номера лежат и как
        // записаны, и только цифрами.
        const digits = phoneTail(v);
        if (digits) conditions.push(`search_text.ilike.%${digits}%`);

        q = q.or(conditions.join(','));
    }

    /**
     * Дубли: список кандидатов уже посчитан базой. Пустой список означает
     * «дублей нет» — показываем пустую таблицу, а не весь список.
     */
    if (filter.duplicatesOnly) {
        q = filter.duplicateIds?.length ? q.in('order_id', filter.duplicateIds) : q.eq('order_id', -1);
    }

    /**
     * Товар ищем по названиям позиций, сложенным в `orders.items_text`.
     * Знаки препинания не важны: в каталоге одно и то же изделие пишут и через
     * дефис, и через длинное тире, и через пробел.
     */
    if (filter.itemName) {
        const v = itemNamePattern(filter.itemName);
        if (v) q = q.ilike('items_text', `%${v}%`);
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

    if (filter.categories.length) q = q.in(COLUMNS.category, filter.categories);
    if (filter.sferas.length) q = q.in(COLUMNS.sfera, filter.sferas);

    if (filter.control === 'yes') q = q.eq(COLUMNS.control, true);
    if (filter.control === 'no') q = q.eq(COLUMNS.control, false);

    // Даты могут быть смещением («неделю назад»): разворачиваем их здесь, в
    // момент запроса, — поэтому сохранённый фильтр «заказы на завтра» завтра
    // означает уже другой день, как в RetailCRM.
    const contactFrom = resolveDate(filter.contactFrom);
    const contactTo = resolveDate(filter.contactTo);
    const purchaseFrom = resolveDate(filter.purchaseFrom);
    const purchaseTo = resolveDate(filter.purchaseTo);
    const createdFrom = resolveDate(filter.createdFrom);
    const createdTo = resolveDate(filter.createdTo);

    if (contactFrom) q = q.gte(COLUMNS.nextContact, contactFrom);
    if (contactTo) q = q.lte(COLUMNS.nextContact, contactTo);

    if (purchaseFrom) q = q.gte(COLUMNS.purchaseMonth, purchaseFrom);
    if (purchaseTo) q = q.lte(COLUMNS.purchaseMonth, purchaseTo);

    if (createdFrom) q = q.gte('created_at', createdFrom);
    if (createdTo) q = q.lte('created_at', `${createdTo}T23:59:59`);

    if (filter.contragent) q = q.ilike('raw_payload->contragent->>legalName', `%${safe(filter.contragent)}%`);
    if (filter.managerComment) q = q.ilike('raw_payload->>managerComment', `%${safe(filter.managerComment)}%`);
    if (filter.customerComment) q = q.ilike('raw_payload->>customerComment', `%${safe(filter.customerComment)}%`);

    /**
     * Поля карточки заказа. Ищем точное совпадение значения: подстрокой
     * (ILIKE) запрос шёл перебором всех заказов и со счётчиком не укладывался
     * в таймаут — список возвращался пустым. Точное совпадение идёт по GIN
     * (миграция 20261005_orders_custom_fields_index.sql): 3,7 с → 76 мс.
     */
    const cf = Object.entries(filter.customFields ?? {})
        .filter(([code, value]) => String(value ?? '').trim() && /^[a-z0-9_]+$/i.test(code));
    if (cf.length) {
        q = q.contains('raw_payload->customFields', Object.fromEntries(
            cf.map(([code, value]) => [code, String(value).trim()]),
        ));
    }

    return q;
}

/**
 * Фильтр в виде, понятном счётчику статусов в базе (`orders_status_counts`).
 *
 * Даты разворачиваем здесь же: в базу уходят готовые числа, а смещения
 * («неделю назад») остаются делом кода — одно правило на оба пути.
 */
export function filterToCountParams(
    filter: OrdersFilter,
    norms: Array<{ status: string; normDays: number }>,
): Record<string, unknown> {
    return {
        number: filter.number || '',
        customer: filter.customer || '',
        itemName: filter.itemName || '',
        // Счётчики статусов и «Итого» считают по тем же карточкам, что и список,
        // иначе цифры разойдутся с показанными строками.
        customerIds: filter.customerIds || [],
        managers: filter.managers.filter(Boolean),
        // Статусы нужны «Итого по фильтру» (orders_filter_totals); счётчики
        // колонки их намеренно игнорируют — иначе по колонке не переключиться.
        statuses: filter.statuses.filter(Boolean),
        vip: filter.marks.includes('vip'),
        bad: filter.marks.includes('bad'),
        sumFrom: filter.sumFrom || '',
        sumTo: filter.sumTo || '',
        categories: filter.categories,
        sferas: filter.sferas,
        control: filter.control || '',
        contactFrom: resolveDate(filter.contactFrom),
        contactTo: resolveDate(filter.contactTo),
        purchaseFrom: resolveDate(filter.purchaseFrom),
        purchaseTo: resolveDate(filter.purchaseTo),
        createdFrom: resolveDate(filter.createdFrom),
        createdTo: resolveDate(filter.createdTo),
        contragent: filter.contragent || '',
        managerComment: filter.managerComment || '',
        customerComment: filter.customerComment || '',
        overdueOnly: Boolean(filter.overdueOnly),
        duplicatesOnly: Boolean(filter.duplicatesOnly),
        duplicateIds: filter.duplicateIds || [],
        norms,
    };
}

/** Есть ли хоть одно заполненное условие — для подсветки кнопки сброса. */
export function isFilterEmpty(filter: OrdersFilter): boolean {
    return Object.values(filter).every((v) => (Array.isArray(v) ? v.length === 0 : !v));
}

/**
 * Оставляет только заказы, выбившиеся из норматива времени в статусе.
 *
 * Норматив свой у каждого статуса, поэтому условие собирается как «статус X и вошёл в
 * него раньше, чем N дней назад» — по одному на статус с нормативом. Заказы без
 * известного момента входа не берём: гадать по ним и обвинять в просрочке нельзя.
 */
export function applyOverdueFilter(query: any, norms: Array<{ status: string; normDays: number }>) {
    if (!norms.length) {
        // Нормативы не заданы ни у одного статуса — просроченных быть не может.
        return query.eq('order_id', -1);
    }

    const clauses = norms.map(({ status, normDays }) => {
        const threshold = new Date(Date.now() - normDays * 86400000).toISOString();
        return `and(status.eq.${status},status_since.lt.${threshold})`;
    });

    return query.not('status_since', 'is', null).or(clauses.join(','));
}
