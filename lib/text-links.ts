/**
 * Разбор текста на куски и ссылки — для показа в интерфейсе.
 *
 * В письме, которое мы показываем у себя, ссылка на каталог оставалась простым
 * текстом, и менеджер решил, что она не работает (Лена Парфёнова 12.10.2026).
 * У клиента в почте она кликабельна — непохоже должно быть только у нас.
 *
 * Разбор держим отдельно от разметки: так его видно тестам, а правило «что
 * считаем ссылкой» живёт в одном месте с серверным `lib/html-links.ts`.
 */

/** Адрес сайта или почты в обычном тексте. */
const LINK = /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b)/gi;

/** Хвостовая пунктуация: «загляните на okk.zmksoft.com/katalog.» — точка не часть адреса. */
const TRAILING = /[.,;:!?)»]+$/;

export type TextPart = string | { href: string; label: string };

export function splitLinks(text: string): TextPart[] {
    const value = String(text ?? '');
    if (!value) return [];

    const parts: TextPart[] = [];
    let last = 0;

    const re = new RegExp(LINK.source, LINK.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
        const raw = match[0];
        const tail = TRAILING.exec(raw)?.[0] ?? '';
        const label = tail ? raw.slice(0, -tail.length) : raw;
        if (!label) continue;

        const href = label.includes('@') && !label.startsWith('http')
            ? `mailto:${label}`
            : label.startsWith('http')
                ? label
                : `https://${label}`;

        if (match.index > last) parts.push(value.slice(last, match.index));
        parts.push({ href, label });
        last = match.index + label.length;
    }

    if (!parts.length) return [value];
    if (last < value.length) parts.push(value.slice(last));
    return parts;
}
