/**
 * Кому отвечать, когда в письме несколько человек.
 *
 * Со стороны клиента в переписке обычно снабженец, бухгалтер и начальник.
 * Ответ одному отправителю разваливает разговор на два, поэтому «ответить
 * всем» ставит остальных в копию. Себя в копию не ставим: мы и так
 * отправитель.
 */

/** Наш ящик и наш домен: письма уходят с него и приходят на него. */
export const OUR_MAIL_DOMAIN = 'zmktlt.ru';

export type MessageRecipients = {
    from: string | null;
    /** Все адреса из «Кому». */
    toAll: string[];
    /** Адреса из «Копии». */
    cc: string[];
};

/** Кто ещё участвовал в письме, кроме нас и отправителя. */
export function othersInConversation(message: MessageRecipients): string[] {
    const sender = String(message.from ?? '').trim().toLowerCase();

    return Array.from(new Set([...(message.toAll ?? []), ...(message.cc ?? [])]))
        .map((address) => String(address ?? '').trim().toLowerCase())
        .filter((address) => address
            && address !== sender
            && !address.endsWith(`@${OUR_MAIL_DOMAIN}`));
}
