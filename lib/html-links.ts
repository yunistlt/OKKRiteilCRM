/**
 * Ссылки в письме должны быть кликабельными.
 *
 * Ответ менеджера собирается из строк текста: каждая строка оборачивается в
 * абзац, и адрес остаётся обычным текстом. В почте у клиента он не нажимается
 * — «ссылку на каталог, она в письме кликабельная должна быть» (Лена
 * Парфёнова 09.10.2026).
 *
 * Поэтому перед отправкой проходим по тексту письма и делаем ссылками то, что
 * ими является: адреса сайтов и почтовые адреса. Уже готовые ссылки
 * (`<a href=…>` из шаблонов и подписи) не трогаем, иначе получится ссылка
 * внутри ссылки.
 */

/** Адрес сайта или почты в обычном тексте. */
const PLAIN_LINK = /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b)/gi;

/** Хвостовая пунктуация: «загляните на okk.zmksoft.com/katalog.» — точка не часть адреса. */
const TRAILING = /[.,;:!?)»]+$/;

function anchor(raw: string): string {
    const tail = TRAILING.exec(raw)?.[0] ?? '';
    const value = tail ? raw.slice(0, -tail.length) : raw;

    const href = value.includes('@') && !value.startsWith('http')
        ? `mailto:${value}`
        : value.startsWith('http')
            ? value
            : `https://${value}`;

    return `<a href="${href}">${value}</a>${tail}`;
}

/**
 * Сделать ссылками адреса в тексте письма.
 *
 * Разбираем по тегам: внутри тегов ничего не меняем, внутри уже существующей
 * ссылки — тоже.
 */
export function linkifyHtml(html: string): string {
    const source = String(html ?? '');
    if (!source) return source;

    let out = '';
    let insideAnchor = false;

    // Куски: либо тег целиком, либо текст между тегами.
    for (const part of source.split(/(<[^>]*>)/g)) {
        if (!part) continue;

        if (part.startsWith('<')) {
            const tag = part.toLowerCase();
            if (tag.startsWith('<a ') || tag === '<a>') insideAnchor = true;
            else if (tag.startsWith('</a')) insideAnchor = false;
            out += part;
            continue;
        }

        out += insideAnchor ? part : part.replace(PLAIN_LINK, (match) => anchor(match));
    }

    return out;
}
