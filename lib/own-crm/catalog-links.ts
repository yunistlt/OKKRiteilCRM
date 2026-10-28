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
    /**
     * Идентификатор товара в каталоге сайта (`marketing_products.id`) — тот самый номер,
     * что виден в адресе картинки: `…/products/13/68/16813/images/…`.
     *
     * Производству он нужен отдельным полем (просьба ЦехУспеха 12.10.2026): названия товара
     * на сайте и в цехе никогда не совпадают, а у одной модели до 10–15 исполнений — по
     * названию их не различить. Технолог один раз подбирает товар, код запоминается в
     * карточке, и дальше позиция опознаётся сама, даже если товар на сайте переименуют.
     * Раньше ЦехУспех выковыривал этот номер из адреса картинки — ломалось бы при смене
     * хранилища картинок и у товаров без фото.
     */
    productId: string;
    url: string;
    /** Название в каталоге — по нему видно, тот ли это товар. */
    name: string;
    /** Фото с карточки товара на сайте — его же показываем в КП. */
    image: string | null;
    /**
     * Вес изделия, как он написан на сайте: «125 кг».
     *
     * Просьба Лены Парфёновой 22.10.2026 (доработки 39 и 40): «нужно, чтобы
     * отображался вес товара». Вес нужен под доставку, а менеджер лазил за ним
     * на сайт по каждой позиции. Берём оттуда же, откуда фото и ссылку —
     * `features.weight` карточки; не указан на сайте — не показываем.
     */
    weight: string | null;
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

/**
 * Вес изделия с карточки сайта. Запросы берут его отдельной колонкой
 * (`weight:raw_data->features->>weight`), а запрос по модификациям — целиком
 * в `raw_data`: поддерживаем оба.
 */
function productWeight(row: any): string | null {
    const value = clean(row?.weight ?? row?.raw_data?.features?.weight);
    return value || null;
}

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
                .select('id, name, full_url, images, raw_data->>id_1c, weight:raw_data->features->>weight')
                .in('raw_data->>id_1c', xmlIds);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (!row.id_1c) continue;
                found.push({
                    key: `1c:${row.id_1c}`,
                    productId: String(row.id ?? ''),
                    url: String(row.full_url ?? ''),
                    name: decodeEntities(String(row.name ?? '')),
                    image: firstImage(row.images),
                    weight: productWeight(row),
                });
            }
        }

        if (ids.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('id, name, full_url, images, weight:raw_data->features->>weight')
                .in('id', ids);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.full_url) found.push({ key: `id:${row.id}`, productId: String(row.id ?? ''), url: String(row.full_url), name: decodeEntities(String(row.name ?? '')), image: firstImage(row.images), weight: productWeight(row) });
            }
        }

        if (articles.length) {
            const { data, error } = await db
                .from('marketing_products')
                .select('id, sku, name, full_url, images, weight:raw_data->features->>weight')
                .in('sku', articles);
            if (error) throw new Error(error.message);
            for (const row of ((data ?? []) as any[])) {
                if (row.sku && row.full_url) {
                    found.push({ key: `art:${clean(row.sku)}`, productId: String(row.id ?? ''), url: String(row.full_url), name: decodeEntities(String(row.name ?? '')), image: firstImage(row.images), weight: productWeight(row) });
                }
            }
        }

        /**
         * Артикул позиции — это артикул МОДИФИКАЦИИ, а не карточки.
         *
         * Товар на витрине заведён одной карточкой с размерами внутри, и в
         * заказ попадает размер: «РИ.13.137.1456.2560.460», «49301». Среди
         * `marketing_products.sku` таких артикулов нет вовсе, поэтому у позиции
         * не было ни фото, ни ссылки на сайт — хотя товар на витрине есть
         * (Лена Парфёнова 26.10.2026 по заказу 54789: «куда деваются актуальные
         * комплекты, да и в целом товар? нет картинки, нет ссылки на сайт»).
         *
         * Ищем такой артикул внутри модификаций. Сначала грубо — по тексту
         * `raw_data`, это умеет база, — а потом точно, по самим модификациям:
         * иначе числовой артикул «49301» совпал бы с любой ценой.
         */
        const unresolved = articles.filter((article) => !found.some((link) => link.key === `art:${article}`));
        for (let i = 0; i < unresolved.length; i += 20) {
            const batch = unresolved.slice(i, i + 20).filter((article) => !/[,()]/.test(article));
            if (!batch.length) continue;

            const { data, error } = await db
                .from('marketing_products')
                .select('id, sku, name, full_url, images, raw_data')
                .or(batch.map((article) => `raw_data->>skus.ilike.%${article}%`).join(','))
                .limit(200);
            if (error) throw new Error(error.message);

            for (const row of ((data ?? []) as any[])) {
                if (!row.full_url) continue;
                const variants = Array.isArray(row.raw_data?.skus) ? row.raw_data.skus : [];
                for (const article of batch) {
                    if (found.some((link) => link.key === `art:${article}`)) continue;
                    const hit = variants.some((variant: any) => {
                        const sku = clean(variant?.sku).toLowerCase();
                        const id = clean(variant?.id);
                        const wanted = article.toLowerCase();
                        return id === article || (Boolean(sku) && (sku === wanted || sku.includes(wanted) || wanted.includes(sku)));
                    });
                    if (!hit) continue;
                    found.push({
                        key: `art:${article}`,
                        productId: String(row.id ?? ''),
                        url: String(row.full_url),
                        name: decodeEntities(String(row.name ?? '')),
                        image: firstImage(row.images),
                        weight: productWeight(row),
                    });
                }
            }
        }
    } catch (e: any) {
        console.warn('[catalog-links] каталог не ответил:', e.message);
    }

    return found;
}

export { siteSearchUrl } from './site-link';
