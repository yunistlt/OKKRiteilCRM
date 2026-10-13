import { supabase } from '@/utils/supabase';
import { normalizeMessageId, parseReferences } from './thread';

/**
 * Чей это заказ: письмо пришло ответом на НАШЕ письмо.
 *
 * Самая надёжная линия привязки (ТЗ §3.1), и её до сих пор не было. Автоприём
 * умел опознавать тред только среди входящих писем, по которым уже заведён
 * заказ, и цеплялся тегом `[#N/NNNNN]` в теме. Но клиент часто отвечает на наше
 * письмо, снеся тему целиком — тег теряется, входящих предшественников нет, и
 * письмо уходит в «Разбор» или заводит дубль заявки.
 *
 * `In-Reply-To` и `References` при этом содержат `Message-ID` нашего письма,
 * а он записан в журнале отправок. Этого достаточно, чтобы знать заказ точно.
 */

export type LinkedOrder = { number: string; id: number | null; reason: string };

/** Идентификаторы писем, на которые ссылается это письмо. */
export function replyChain(letter: {
    in_reply_to?: unknown;
    email_refs?: unknown;
}): string[] {
    const chain = [
        ...parseReferences(letter.email_refs),
        normalizeMessageId(letter.in_reply_to),
    ].filter((item): item is string => Boolean(item));

    return Array.from(new Set(chain));
}

/**
 * Найти заказ по нашему письму, на которое отвечают.
 *
 * Сверяем по журналу отправок (`order_email_sends`) и по папке «Отправленные»
 * (`outgoing_emails`): в первом лежат письма из карточки заказа, во втором —
 * всё, что ушло с ящика, включая письма RetailCRM.
 */
export async function findOrderByOurReply(letter: {
    in_reply_to?: unknown;
    email_refs?: unknown;
}): Promise<LinkedOrder | null> {
    const chain = replyChain(letter);
    if (!chain.length) return null;

    /**
     * В базе `message_id` записан со скобками («<abc@mail>»), а сравниваем мы
     * без них. Поэтому спрашиваем оба написания — поиск по выражению тут
     * обошёлся бы полным перебором таблицы.
     */
    const variants = Array.from(new Set(chain.flatMap((id) => [id, `<${id}>`])));

    const [sentRes, boxRes] = await Promise.all([
        supabase
            .from('order_email_sends')
            .select('order_number, order_id, message_id, created_at')
            .in('message_id', variants)
            .order('created_at', { ascending: false })
            .limit(5),
        supabase
            .from('outgoing_emails')
            .select('order_number, message_id, sent_at')
            .in('message_id', variants)
            .not('order_number', 'is', null)
            .order('sent_at', { ascending: false })
            .limit(5),
    ]);

    const sent = ((sentRes.data ?? []) as any[])[0];
    if (sent?.order_number) {
        return {
            number: String(sent.order_number),
            id: sent.order_id ? Number(sent.order_id) : null,
            reason: 'Ответ на наше письмо по заказу',
        };
    }

    const box = ((boxRes.data ?? []) as any[])[0];
    if (box?.order_number) {
        return {
            number: String(box.order_number),
            id: null,
            reason: 'Ответ на письмо из «Отправленных»',
        };
    }

    return null;
}
