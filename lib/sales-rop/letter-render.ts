/**
 * Письмо бота-РОПа в вебе: тот же текст, что уходит в Telegram, но ссылки —
 * на карточку заказа в нашей CRM.
 *
 * Бот пишет для Telegram, то есть HTML-разметкой (`<a href>`, `<b>`), а окно
 * плана показывало её как есть: менеджер читал «<a href="...">№53603</a>»
 * вместо номера заказа (поймано 02.10.2026). Плюс ссылки вели в RetailCRM,
 * откуда менеджер уже переехал.
 */

export type LetterSegment =
    | { kind: 'text'; text: string }
    /** Номер заказа ссылкой на нашу карточку. */
    | { kind: 'order'; label: string; order: string };

const ENTITIES: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};

/** Человеческий текст из того, что бот отправил в Telegram. */
export function decodeEntities(text: string): string {
    return text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match);
}

/** Снять теги, которые в вебе не нужны (`<b>`, `<i>`, `<code>`). */
function stripTags(text: string): string {
    return decodeEntities(text.replace(/<\/?[a-z][^>]*>/gi, ''));
}

/** Номер заказа из ссылки бота: и RetailCRM, и наша. */
function orderFromHref(href: string, label: string): string | null {
    const fromHref = /orders?\/(\d+)/i.exec(href) || /[?&]order=([\w-]+)/i.exec(href);
    if (fromHref) return fromHref[1];
    // Ссылка чужая или незнакомая — берём номер из текста ссылки («№54632»).
    const fromLabel = /№\s*([\w-]+)/.exec(label);
    return fromLabel ? fromLabel[1] : null;
}

/**
 * Разобрать строку письма на куски: обычный текст и номера заказов ссылками.
 */
export function renderLetterLine(line: string): LetterSegment[] {
    const segments: LetterSegment[] = [];
    const anchor = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = anchor.exec(line)) !== null) {
        if (match.index > cursor) {
            segments.push({ kind: 'text', text: stripTags(line.slice(cursor, match.index)) });
        }

        const label = stripTags(match[2]).trim() || 'заказ';
        const order = orderFromHref(match[1], label);
        if (order) segments.push({ kind: 'order', label, order });
        else segments.push({ kind: 'text', text: label });

        cursor = match.index + match[0].length;
    }

    if (cursor < line.length) {
        segments.push({ kind: 'text', text: stripTags(line.slice(cursor)) });
    }

    return segments.filter((segment) => segment.kind !== 'text' || segment.text !== '');
}

/** Всё письмо строками — в том же порядке и с теми же пустыми строками. */
export function renderLetter(text: string): LetterSegment[][] {
    return String(text ?? '')
        .split('\n')
        .map((line) => renderLetterLine(line));
}
