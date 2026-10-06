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
import { proxiedImageUrl } from './catalog-image';
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
    /** Фото с карточки товара на сайте — его же показываем в КП. */
    image: string | null;
};

/**
 * Первое фото карточки товара: в каталоге они лежат списком.
 *
 * Адрес отдаём через российский сервер: сайт пускает только российские адреса,
 * и напрямую фото не доходило ни в карточку заказа, ни в КП (см.
 * `catalog-image.ts`).
 */
function firstImage(images: unknown): string | null {
    const list = Array.isArray(images) ? images : [];
    for (const image of list) {
        const url = String((image as any)?.url ?? '').trim();
        if (url) return proxiedImageUrl(url);
    }
    return null;
}

const clean = (value: unknown): string => String(value ?? '').replace(/^"+|"+$/g, '').trim();

/** Ссылки по идентификаторам товаров сайта и, запасным ключом, по артикулам. */
export async function catalogLinks(params: {
    siteIds?: Array<string | number | null | undefined>;
    articles?: Array<string | null | undefined>;
    /**
     * Идентификаторы товара в 1С (`offer.xmlId`). Самый надёжный ключ: в
     * каталоге сайта это `raw_data->>id_1c`, и он совпадает там, где id сайта
     * и артикул уже разошлись — номера товаров в заказах ушли за 40 000, а в
     * каталоге сайта кончаются на 29 420.
     */
    xmlIds?: Array<string | null | undefined>;
}): Promise<CatalogLink[]> {
    if (!catalogLinksConfigured()) return [];

    const ids = Array.from(
        new Set((params.siteIds ?? []).map((id) => clean(id)).filter((id) => /^\d+$/.test(id))),
    ).slice(0, 300);
    const articles = Array.from(
        new Set((params.articles ?? []).map((article) => clean(article)).filter((article) => article.length > 1)),
    ).slice(0, 300);

    const xmlIds = Array.from(
        new Set((params.xmlIds ?? []).map((id) => clean(id).split('#')[0]).filter((id) => id.length > 8)),
    ).slice(0, 300);

    const db = client();
    const found: CatalogLink[] = [];

    try {
        if (xmlIds.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('id, name, full_url, images, raw_data->>id_1c')
                .in('raw_data->>id_1c', xmlIds);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (!row.id_1c) continue;
                found.push({
                    key: `1c:${row.id_1c}`,
                    url: String(row.full_url ?? ''),
                    name: decodeEntities(String(row.name ?? '')),
                    image: firstImage(row.images),
                });
            }
        }

        if (ids.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('id, name, full_url, images')
                .in('id', ids);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.full_url) found.push({ key: `id:${row.id}`, url: String(row.full_url), name: decodeEntities(String(row.name ?? '')), image: firstImage(row.images) });
            }
        }

        if (articles.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('sku, name, full_url, images')
                .in('sku', articles);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.sku && row.full_url) {
                    found.push({ key: `art:${clean(row.sku)}`, url: String(row.full_url), name: decodeEntities(String(row.name ?? '')), image: firstImage(row.images) });
                }
            }
        }
    } catch (e: any) {
        console.warn('[catalog-links] каталог не ответил:', e.message);
    }

    return found;
}

export { siteSearchUrl } from './site-link';
