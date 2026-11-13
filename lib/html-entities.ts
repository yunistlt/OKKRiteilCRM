/**
 * Человеческий текст из HTML-кодов.
 *
 * Одно место на весь проект: раньше каждый читатель писем расшифровывал коды
 * своим куском (`lib/email.ts`, `lib/order-mail/load.ts`,
 * `lib/own-crm/order-mail.ts`, бот-РОП), и каждый знал ровно шесть названий —
 * `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`.
 *
 * Числовых кодов не знал никто. Отправители, пишущие письмо редактором
 * (Ruselt, 1С, старые почтовики), шлют русский текст именно ими:
 * «&#1047;&#1076;&#1088;…» вместо «Здрав…». Такое письмо в карточке заказа
 * читалось набором цифр — доработки №83 и №91 (Ирина Гордеева, заказ 900475):
 * «входящее письмо не читается», «открываю заново — так же».
 */

const NAMED: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    laquo: '«',
    raquo: '»',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
    deg: '°',
    euro: '€',
    copy: '©',
    reg: '®',
    trade: '™',
    middot: '·',
    bull: '•',
    times: '×',
    minus: '−',
    rub: '₽',
};

export function decodeEntities(text: string): string {
    return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
        const code = String(body);

        if (code[0] === '#') {
            const number = code[1] === 'x' || code[1] === 'X'
                ? parseInt(code.slice(2), 16)
                : parseInt(code.slice(1), 10);
            // Непечатаемое и несуществующее оставляем как есть: лучше код в
            // тексте, чем пустое место там, где был символ.
            if (!Number.isFinite(number) || number < 9 || number > 0x10ffff) return match;
            try {
                return String.fromCodePoint(number);
            } catch {
                return match;
            }
        }

        return NAMED[code.toLowerCase()] ?? match;
    });
}

/**
 * Читаемый текст из HTML-письма: теги убраны, коды расшифрованы.
 *
 * Один текст на всех читателей писем — ленту заказа, карточку, автоприём.
 * Раньше у каждого была своя копия этих правил, и расходились они молча.
 */
export function htmlToPlainText(html: unknown): string {
    return decodeEntities(
        String(html ?? '')
            .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
            .replace(/<[^>]+>/g, ''),
    )
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
