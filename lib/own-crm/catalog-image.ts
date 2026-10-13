/**
 * Адрес фото товара: через российский сервер, а не напрямую с сайта.
 *
 * Разбор 06.10.2026. Сайт zmktlt.ru отвечает только российским адресам:
 * с сервера в России картинка отдаётся (HTTP 200, 20 КБ), с зарубежного
 * соединения нет вовсе. ОКК собирается на зарубежном сервере, поэтому в
 * карточке заказа фото не грузилось, а в КП клиенту уходила пустая колонка
 * «Фото» — молча, без ошибки: сборщик PDF просто пропускает картинку, которую
 * не смог забрать.
 *
 * Поэтому адрес фото подменяем на наш сервер в России (erp.zmksoft.ru), он
 * ходит за картинкой сам. Подменяем только медиафайлы магазина (`/wa-data/`) и
 * только у знакомых хостов — чужие адреса не трогаем.
 *
 * Сервер не задан — возвращаем адрес как есть: в России всё работает и
 * напрямую, и ломать это нельзя.
 */

/** Хосты сайта, чьи картинки возим через себя. */
const SITE_HOSTS = ['zmktlt.ru', 'www.zmktlt.ru'];

/** Папка медиафайлов магазина — только её и пропускает прокси. */
const MEDIA_PATH = '/wa-data/';

export function imageProxyBase(): string {
    return (process.env.CATALOG_IMAGE_PROXY_BASE || '').trim().replace(/\/+$/, '');
}

/** Адрес фото, по которому его видно и из России, и из-за рубежа. */
export function proxiedImageUrl(raw: string | null | undefined): string | null {
    const value = String(raw ?? '').trim();
    if (!value) return null;

    const base = imageProxyBase();
    if (!base) return value;

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        // Не адрес — отдаём как есть, подменять нечего.
        return value;
    }

    if (!SITE_HOSTS.includes(parsed.hostname.toLowerCase())) return value;
    if (!parsed.pathname.startsWith(MEDIA_PATH)) return value;

    return `${base}${parsed.pathname}${parsed.search}`;
}
