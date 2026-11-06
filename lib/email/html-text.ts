/**
 * HTML письма → читаемый текст. Одно место на весь проект.
 *
 * Разбор сущностей жил в трёх копиях (лента переписки, отправка, классификация
 * Катерины), и каждая знала шесть именованных сущностей. Письма из почтовых
 * программ, которые пишут кириллицу числовыми сущностями (`&#1047;` — «З»),
 * доезжали до менеджера кашей: «&#1047;&#1076;&#1088;...» вместо
 * «Здравствуйте» (Ирина Гордеева 06.11.2026, доработка 83, заказ 900475).
 * Катерина на таких письмах классифицировала пустой текст.
 */

/** Сущности, которые встречаются в письмах чаще числовых. */
const NAMED: Record<string, string> = {
    // Точный символ: неразрывный пробел. В обычный его превращает
    // htmlToPlainText — там это текст для чтения, а не разметка.
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    laquo: '«',
    raquo: '»',
    mdash: '—',
    ndash: '–',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    hellip: '…',
    deg: '°',
    euro: '€',
    copy: '©',
    reg: '®',
    trade: '™',
};

/**
 * Числовые (`&#1047;`, `&#x417;`) и ходовые именованные сущности — в символы.
 *
 * Чего не знаем, оставляем как есть: лучше `&bdquo;` в тексте, чем дырка на
 * месте слова.
 */
export function decodeHtmlEntities(input: unknown): string {
    return String(input ?? '')
        .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => fromCode(parseInt(hex, 16), whole))
        .replace(/&#(\d+);/g, (whole, dec) => fromCode(Number(dec), whole))
        .replace(/&([a-z]+);/gi, (whole, name) => NAMED[String(name).toLowerCase()] ?? whole);
}

/** Код за пределами Юникода или управляющий — оставляем запись как была. */
function fromCode(code: number, whole: string): string {
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
    try {
        return String.fromCodePoint(code);
    } catch {
        return whole;
    }
}

/**
 * Тело письма как текст: без разметки, с переводами строк на месте абзацев.
 *
 * Сущности разбираем ПОСЛЕ снятия тегов: иначе `&lt;b&gt;` превратился бы в
 * тег и следующий проход его бы съел вместе с текстом.
 */
export function htmlToPlainText(html: unknown): string {
    const withoutMarkup = String(html ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(withoutMarkup)
        .replace(/ /g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
