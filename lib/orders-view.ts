/**
 * Реестры колонок списка заказов и полей панели фильтров.
 *
 * В RetailCRM это две шестерёнки: одна выбирает колонки таблицы, другая — поля фильтра.
 * В обеих можно включать нужное и менять порядок. Реестр держим в одном месте, чтобы
 * настройка и отрисовка не разъезжались.
 */

export interface ViewItem {
    key: string;
    label: string;
    group: string;
    /** Снять нельзя — без него список нечитаем. */
    locked?: boolean;
}

export const ORDER_COLUMNS: ViewItem[] = [
    { key: 'status', label: 'Статус заказа', group: 'Основное', locked: true },
    { key: 'number', label: 'Номер', group: 'Основное', locked: true },
    { key: 'customer', label: 'Покупатель', group: 'Покупатель' },
    { key: 'contragent', label: 'Наименование контрагента', group: 'Контрагент' },
    { key: 'manager', label: 'Менеджер', group: 'Основное' },
    { key: 'managerComment', label: 'Комментарий оператора', group: 'Комментарии' },
    { key: 'customerComment', label: 'Комментарий клиента', group: 'Комментарии' },
    { key: 'items', label: 'Состав', group: 'Товары' },
    { key: 'category', label: 'Категория товара', group: 'Товары' },
    { key: 'sfera', label: 'Сфера деятельности', group: 'Покупатель' },
    { key: 'totalSumm', label: 'Сумма заказа', group: 'Стоимость' },
    { key: 'createdAt', label: 'Дата и время', group: 'Даты' },
    { key: 'nextContact', label: 'Дата следующего контакта', group: 'Даты' },
    { key: 'phone', label: 'Телефон', group: 'Покупатель' },
    { key: 'email', label: 'Почта', group: 'Покупатель' },
];

export const DEFAULT_COLUMNS = [
    'status', 'number', 'customer', 'manager', 'managerComment', 'items', 'totalSumm', 'createdAt', 'nextContact',
];

export const FILTER_FIELDS: ViewItem[] = [
    { key: 'number', label: 'Номер заказа', group: 'Основное' },
    { key: 'customer', label: 'Покупатель', group: 'Покупатель' },
    { key: 'managers', label: 'Менеджеры', group: 'Основное' },
    { key: 'marks', label: 'Пометки', group: 'Покупатель' },
    { key: 'sum', label: 'Сумма заказа', group: 'Стоимость' },
    { key: 'statuses', label: 'Статус заказа', group: 'Основное' },
    { key: 'categories', label: 'Категория товара', group: 'Товары' },
    { key: 'sferas', label: 'Сфера деятельности', group: 'Покупатель' },
    { key: 'control', label: 'КОНТРОЛЬ', group: 'Основное' },
    { key: 'contragent', label: 'Наименование контрагента', group: 'Контрагент' },
    { key: 'contact', label: 'Дата следующего контакта', group: 'Даты' },
    { key: 'created', label: 'Дата оформления заказа', group: 'Даты' },
    { key: 'purchase', label: 'В каком месяце планируете закупку', group: 'Даты' },
    { key: 'managerComment', label: 'Комментарий оператора', group: 'Комментарии' },
    { key: 'customerComment', label: 'Комментарий клиента', group: 'Комментарии' },
];

export const DEFAULT_FILTER_FIELDS = FILTER_FIELDS.map((f) => f.key);

/** Приводит сохранённый список к реестру: выкидывает исчезнувшее, дописывает обязательное. */
export function normalizeSelection(saved: unknown, registry: ViewItem[], fallback: string[]): string[] {
    const known = new Set(registry.map((i) => i.key));
    const locked = registry.filter((i) => i.locked).map((i) => i.key);

    const list = Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string' && known.has(k)) : null;
    const base = list && list.length ? list : fallback.filter((k) => known.has(k));

    // Обязательные колонки возвращаем в начало, если их сняли в обход интерфейса.
    const missingLocked = locked.filter((k) => !base.includes(k));
    return [...missingLocked, ...base];
}
