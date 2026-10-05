/**
 * Поля карточки заказа как колонки списка и поля фильтра.
 *
 * Решение владельца 05.10.2026: «в фильтре надо, чтобы можно было добавить
 * любое поле из карточки заказа». Женя Матвеева просила туда же наименование
 * товара и город поставки — они сверяют по ним дубли.
 *
 * Поэтому реестр собирается, а не пишется руками: к постоянным колонкам
 * добавляются дополнительные поля заказа из справочника RetailCRM — с их
 * названиями оттуда же (закон «имена из RetailCRM»). Ключ такого поля —
 * `cf.<код>`.
 */
import { supabase } from '@/utils/supabase';
import { FILTER_FIELDS, ORDER_COLUMNS, type ViewItem } from '@/lib/orders-view';

/** Группа, в которой показываем поля карточки. */
const GROUP = 'Поля заказа';

export type ViewRegistry = { columns: ViewItem[]; filters: ViewItem[] };

let cache: { at: number; value: ViewItem[] } | null = null;

/** Дополнительные поля заказа из справочника RetailCRM. */
async function customFieldItems(): Promise<ViewItem[]> {
    if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;

    const { data } = await supabase
        .from('retailcrm_custom_fields')
        .select('code, name, entity')
        .eq('entity', 'order');

    const items = ((data ?? []) as any[])
        .filter((row) => row.code && row.name)
        .map((row) => ({ key: `cf.${row.code}`, label: String(row.name), group: GROUP }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

    cache = { at: Date.now(), value: items };
    return items;
}

export async function viewRegistry(): Promise<ViewRegistry> {
    const custom = await customFieldItems();

    // Своё поле не дублируем постоянным: «Категория товара» и «Сфера
    // деятельности» уже есть в реестре под своими ключами.
    const taken = new Set([
        'typ_castomer',
        'sfera_deiatelnosti',
        'data_kontakta',
        'kogda_vam_nuzhno_chtoby_oborudovanie_uzhe_stoialo_pole_dlia_daty',
    ].map((code) => `cf.${code}`));

    const extra = custom.filter((item) => !taken.has(item.key));

    return {
        columns: [...ORDER_COLUMNS, ...extra],
        filters: [...FILTER_FIELDS, ...extra],
    };
}
