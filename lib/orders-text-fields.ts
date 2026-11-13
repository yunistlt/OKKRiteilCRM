import { supabase } from '@/utils/supabase';

/**
 * Текстовые поля карточки заказа — те, что фильтр ищет подстрокой.
 *
 * Какие поля текстовые, знает справочник полей RetailCRM, а какие из них
 * лежат своей колонкой — база (`orders_text_filter_fields`). Здесь только
 * короткая память, чтобы не спрашивать это на каждый показ списка.
 *
 * Справочник меняется редко — минуты хватает, чтобы новое поле доехало до
 * фильтра без выкатки.
 */
const TTL_MS = 60_000;

let cache: { at: number; codes: string[] } | null = null;

export async function textFilterFields(): Promise<string[]> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.codes;

    const { data, error } = await supabase.rpc('orders_text_filter_fields');
    if (error) {
        // Справочник не поднялся — фильтр работает по-старому, целым
        // значением: пустой список хуже неточного, но список заказов важнее.
        console.warn('[orders-filter] не прочитал текстовые поля:', error.message);
        return cache?.codes ?? [];
    }

    const codes = ((data ?? []) as any[])
        .map((row) => String(typeof row === 'object' ? Object.values(row)[0] : row))
        .filter(Boolean);
    cache = { at: Date.now(), codes };
    return codes;
}
