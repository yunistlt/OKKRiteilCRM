/**
 * Номер заказа из темы письма.
 *
 * Наши письма по заказу уходят с тегом в теме: `[#2/49583] …` — где 2 это
 * магазин, а 49583 номер заказа. Тег ставим мы сами (lib/order-relevance-email,
 * sendOrderEmail), и он же приходит обратно в ответах клиентов («Re: [#2/…]»).
 * По нему письмо и цепляется к заказу — так же, как это делает RetailCRM
 * (решение владельца 02.10.2026: «письма очень важны»).
 *
 * Почему не ищем номер где угодно в теме: пятизначных чисел в письмах много —
 * индексы, суммы, артикулы. Тег однозначен, остальное — догадка, поэтому
 * догадку отдаём отдельно (`guessed`) и привязкой не считаем.
 */

const TAG = /\[#\d+\/(\d+)\]/;
const ORDER_WORD = /(?:заказ|заказу|заказа|order)\s*№?\s*(\d{4,6})/i;

export type SubjectOrder = {
    /** Номер заказа из тега — надёжная привязка. */
    tagged: string | null;
    /** Номер, угаданный по словам «заказ 49583» — требует подтверждения. */
    guessed: string | null;
};

export function orderFromSubject(subject: unknown): SubjectOrder {
    const text = String(subject ?? '');

    const byTag = TAG.exec(text);
    if (byTag) return { tagged: byTag[1], guessed: null };

    const byWord = ORDER_WORD.exec(text);
    return { tagged: null, guessed: byWord ? byWord[1] : null };
}

/** Только надёжный номер — им и привязываем письмо к заказу. */
export function taggedOrderNumber(subject: unknown): string | null {
    return orderFromSubject(subject).tagged;
}

/**
 * Число похоже на ГОД, а не на номер заказа.
 *
 * Жалоба Евгении Матвеевой 19.10.2026: письмо с запросом акта сверки ушло ей,
 * а должно было уйти в бухгалтерию. Разбор: клиент писал «прошу сделать акт
 * сверки за 2026 год», классификатор принял «2026» за номер заказа, а такой
 * заказ в базе есть — отменённый, от 2017 года. Письмо привязалось к нему и
 * поэтому в бухгалтерию не поехало: письмо по заказу ведёт менеджер заказа.
 * Так ушли три письма за месяц, все про акты сверки.
 *
 * Поэтому число-год, стоящее рядом со словами про год, квартал или период,
 * номером заказа не считаем. Номер в теге `[#N/NNNNN]` эта проверка не
 * трогает: он однозначен.
 */
const YEAR_CONTEXT = [
    // «за 2026 год», «2026 г.», «2026г»
    (n: string) => new RegExp(`${n}\\s*(?:год|года|г\\.|г\\b)`, 'i'),
    // «за 2026», «период 2026», «сверки 2026»
    (n: string) => new RegExp(`(?:за|период|сверк\\w*|квартал\\w*|кв\\.)\\s+(?:[^\\d]{0,20})?${n}`, 'i'),
];

export function looksLikeYearNotOrder(orderNumber: string, ...texts: Array<unknown>): boolean {
    const n = String(orderNumber ?? '').trim();
    // Номер заказа у нас четырёхзначный тоже бывает — отсекаем только диапазон лет.
    if (!/^(19|20)\d{2}$/.test(n)) return false;

    const haystack = texts.map((t) => String(t ?? '')).join('\n');
    return YEAR_CONTEXT.some((build) => build(n).test(haystack));
}
