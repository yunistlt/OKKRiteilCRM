/**
 * Комментарий менеджера по заказу — лентой записей, а не сплошным полотном.
 *
 * Решение владельца 05.10.2026: «каждый комментарий тегается датой и временем
 * самой системой, чтобы менеджерам не надо было руками писать», а в списке
 * заказов записи идут по убыванию даты — первая самая свежая.
 *
 * Отдельной таблицы под записи нет намеренно: комментарий живёт в заказе одним
 * полем (и в RetailCRM тоже), его читают письма, ОКК и бот-РОП. Поэтому запись
 * — это строка с меткой в начале, а разбор ленты — вот этот разбор.
 */

/** Метка записи: «05.10.2026 14:30 Гордеева Ирина:». */
export function stampComment(text: string, author: string | null, date = new Date()): string {
    // Время московское: сервер работает не в нашем поясе, а метку читают люди
    // в Тольятти — «14:30» должно означать их 14:30.
    const day = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const who = String(author ?? '').trim();
    const clean = String(text ?? '').trim();
    return `${day} ${time}${who ? ` ${who}` : ''}: ${clean}`;
}

/** Дописать новую запись НАВЕРХ ленты: свежее читают первым. */
export function prependComment(existing: string, text: string, author: string | null, date = new Date()): string {
    const entry = stampComment(text, author, date);
    const before = String(existing ?? '').trim();
    return before ? `${entry}\n\n${before}` : entry;
}

export type CommentEntry = {
    /** Дата записи, если она размечена меткой. */
    at: string | null;
    text: string;
};

/**
 * Метка нашей записи: «05.10.2026 14:30 Фамилия Имя: текст».
 *
 * Старые записи люди писали руками и как придётся: «29.09.2026 приостановка
 * счетов», «29.09 созвон», «01.10недозвон» — без года, без двоеточия и даже
 * без пробела после даты. Разбираем и такие, иначе лента по старым заказам
 * останется одним куском.
 */
const STAMP = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?:[ ,]+(\d{2}):(\d{2}))?(?:\s*([^:\n]{0,60}):)?\s*/;

/**
 * Лента записей из одного поля. Старые комментарии писались как придётся —
 * «29.09 приостановка счетов…», «01.10недозвон», — поэтому всё, что не
 * разобралось меткой, остаётся одной записью без даты, а не теряется.
 */
export function parseComment(value: string | null | undefined): CommentEntry[] {
    const text = String(value ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) return [];

    const entries: CommentEntry[] = [];
    let current: CommentEntry | null = null;

    for (const line of text.split('\n')) {
        const match = STAMP.exec(line.trim());
        if (match) {
            if (current) entries.push(current);
            const [, dd, mm, yyyy, hh, mi] = match;
            // Года в старых записях нет — считаем текущий: комментарии ведут
            // по идущим сейчас заказам, а для порядка в ленте год нужен.
            const year = yyyy ?? String(new Date().getFullYear());
            current = {
                at: `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh ?? '00'}:${mi ?? '00'}:00`,
                text: line.trim().slice(match[0].length).trim(),
            };
            continue;
        }
        if (current) current.text = `${current.text}\n${line}`.trim();
        else current = { at: null, text: line };
    }
    if (current) entries.push(current);

    return entries
        .filter((entry) => entry.text.trim())
        .sort((a, b) => {
            // Без даты — вниз: такие записи старые, их писали до меток.
            if (!a.at && !b.at) return 0;
            if (!a.at) return 1;
            if (!b.at) return -1;
            return b.at.localeCompare(a.at);
        });
}

/** Самая свежая запись — её показывает список заказов. */
export function latestComment(value: string | null | undefined): CommentEntry | null {
    return parseComment(value)[0] ?? null;
}
