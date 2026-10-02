/**
 * Ссылки на карточки товаров сайта для состава заказа.
 *
 * Решение владельца 02.10.2026: база товаров у нас — это база сайта, поэтому
 * название позиции не правится руками и ведёт на карточку товара на сайте.
 *
 * Ключ — идентификатор товара на сайте. В заказе он лежит в
 * `items[].offer.externalId` (RetailCRM хранит там id из выгрузки сайта), в
 * каталоге это `marketing_products.id`. Артикул (`offer.article` против
 * `sku`) оставлен запасным ключом: у части позиций он записан по-своему, с
 * кавычками, и совпадает редко.
 *
 * Чего на сайте уже нет (архивные товары — в RetailCRM они лежат в группе
 * «! АРХИВ (SEO)»), тому ссылки не будет: из 300 проверенных товаров заказов
 * на сайте нашлось 15. Врать ссылкой в никуда нельзя, поэтому название
 * остаётся обычным текстом.
 */
import { decodeEntities } from '@/lib/sales-rop/letter-render';
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
    /** Ключ, по которому позиция узнаёт свою ссылку: `id:<id сайта>` или `art:<артикул>`. */
    key: string;
    url: string;
    /** Название в каталоге — по нему видно, тот ли это товар. */
    name: string;
};

const clean = (value: unknown): string => String(value ?? '').replace(/^"+|"+$/g, '').trim();

/** Ссылки по идентификаторам товаров сайта и, запасным ключом, по артикулам. */
export async function catalogLinks(params: {
    siteIds?: Array<string | number | null | undefined>;
    articles?: Array<string | null | undefined>;
}): Promise<CatalogLink[]> {
    if (!catalogLinksConfigured()) return [];

    const ids = Array.from(
        new Set((params.siteIds ?? []).map((id) => clean(id)).filter((id) => /^\d+$/.test(id))),
    ).slice(0, 300);
    const articles = Array.from(
        new Set((params.articles ?? []).map((article) => clean(article)).filter((article) => article.length > 1)),
    ).slice(0, 300);

    const db = client();
    const found: CatalogLink[] = [];

    try {
        if (ids.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('id, name, full_url')
                .in('id', ids);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.full_url) found.push({ key: `id:${row.id}`, url: String(row.full_url), name: decodeEntities(String(row.name ?? '')) });
            }
        }

        if (articles.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('sku, name, full_url')
                .in('sku', articles);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.sku && row.full_url) {
                    found.push({ key: `art:${clean(row.sku)}`, url: String(row.full_url), name: decodeEntities(String(row.name ?? '')) });
                }
            }
        }
    } catch (e: any) {
        console.warn('[catalog-links] каталог не ответил:', e.message);
    }

    return found;
}

export { siteSearchUrl } from './site-link';
