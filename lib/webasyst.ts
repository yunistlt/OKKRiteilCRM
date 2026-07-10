/**
 * Живой доступ к каталогу сайта zmktlt.ru через Webasyst Shop-Script API.
 *
 * Используется, чтобы взять АКТУАЛЬНУЮ цену товара напрямую с сайта (а не из кэша
 * marketing_products, где цена — снимок на момент импорта). Имя/ссылку/категорию
 * товара по-прежнему берём из кэша (они стабильны), а цену добираем отсюда по ID.
 *
 * Требует env WEBASYST_ACCESS_TOKEN (+ опционально WEBASYST_API_URL). Без токена
 * все функции деградируют в no-op (возвращают null / кэш-цену), не ломая поток.
 */

const WEBASYST_API_URL = process.env.WEBASYST_API_URL || 'https://www.zmktlt.ru/api.php';
const WEBASYST_ACCESS_TOKEN = process.env.WEBASYST_ACCESS_TOKEN;

export function isWebasystConfigured(): boolean {
    return Boolean(WEBASYST_ACCESS_TOKEN);
}

/**
 * Актуальная цена товара с сайта по его ID (shop.product.getInfo).
 * Возвращает null при отсутствии токена, ошибке API или нулевой/некорректной цене.
 */
export async function fetchLiveProductPrice(productId: string | number): Promise<number | null> {
    if (!WEBASYST_ACCESS_TOKEN || productId === undefined || productId === null || productId === '') return null;
    try {
        const url = `${WEBASYST_API_URL}/shop.product.getInfo?id=${encodeURIComponent(String(productId))}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${WEBASYST_ACCESS_TOKEN}` },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        const data: any = await res.json();
        if (data?.status === 'fail') return null;
        // Ответ бывает как { product: {...} }, так и самим объектом товара
        const product = data?.product ?? data;
        const price = Number(product?.price);
        return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
        return null;
    }
}

export type CatalogProductRef = {
    id?: string | number;
    name: string;
    price?: number;      // цена из кэша (fallback)
    url?: string;
    category?: string;
    priceSource?: 'live' | 'cache';
};

/**
 * Обогащает найденные в каталоге позиции АКТУАЛЬНОЙ ценой с сайта (по ID).
 * Если живую цену получить не удалось — оставляет кэш-цену и помечает источник как 'cache'.
 * Запросы к сайту идут параллельно; безопасно вызывать без токена (вернёт кэш).
 */
export async function enrichWithLivePrice<T extends CatalogProductRef>(
    products: T[] | null | undefined
): Promise<Array<T & { price: number; priceSource: 'live' | 'cache' }>> {
    const list = Array.isArray(products) ? products : [];
    return Promise.all(
        list.map(async (p) => {
            const live = p.id !== undefined ? await fetchLiveProductPrice(p.id) : null;
            const price = live ?? (typeof p.price === 'number' ? p.price : 0);
            return { ...p, price, priceSource: (live ? 'live' : 'cache') as 'live' | 'cache' };
        })
    );
}
