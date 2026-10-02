/**
 * Ссылки на карточки товаров сайта для состава заказа.
 *
 * Решение владельца 02.10.2026: название товара в карточке не правится руками —
 * товары берутся из базы, а само название ведёт на карточку товара на сайте.
 *
 * Ключ — артикул: в заказе он лежит в `items[].offer.article`, а в каталоге
 * соседнего проекта это `marketing_products.sku`. Идентификаторы товара у
 * RetailCRM свои (uuid в `offer.xmlId`) и с каталогом сайта не совпадают,
 * поэтому по ним искать нельзя.
 */
import { createClient } from '@supabase/supabase-js';

const URL_KEY = 'LVZ_SUPABASE_URL';
const KEY_KEY = 'LVZ_SUPABASE_ANON_KEY';

export function catalogLinksConfigured(): boolean {
    return Boolean(process.env[URL_KEY]?.trim() && process.env[KEY_KEY]?.trim());
}

function client() {
    return createClient(process.env[URL_KEY]!, process.env[KEY_KEY]!);
}

export type CatalogLink = {
    article: string;
    url: string;
    /** Название в каталоге — по нему видно, тот ли это товар. */
    name: string;
};

/**
 * Ссылки по артикулам. Чего нет в каталоге — того нет в ответе: название
 * тогда остаётся обычным текстом, и это честнее ссылки в никуда.
 */
export async function catalogLinksByArticles(articles: Array<string | null | undefined>): Promise<CatalogLink[]> {
    const list = Array.from(
        new Set(
            (articles ?? [])
                .map((article) => String(article ?? '').trim())
                .filter((article) => article.length > 1),
        ),
    ).slice(0, 200);

    if (!list.length || !catalogLinksConfigured()) return [];

    try {
        const { data, error } = await client()
            .from('marketing_products')
            .select('sku, name, full_url')
            .in('sku', list);

        if (error) throw new Error(error.message);

        return ((data ?? []) as any[])
            .filter((row) => row.sku && row.full_url)
            .map((row) => ({ article: String(row.sku), url: String(row.full_url), name: String(row.name ?? '') }));
    } catch (e: any) {
        console.warn('[catalog-links] каталог не ответил:', e.message);
        return [];
    }
}
