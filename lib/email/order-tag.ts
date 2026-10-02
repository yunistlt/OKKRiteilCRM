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
