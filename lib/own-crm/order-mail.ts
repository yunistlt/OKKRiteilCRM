/**
 * Переписка по заказу: настоящие письма, а не события истории RetailCRM.
 *
 * Лента «Письма и сообщения» в карточке раньше строилась только из истории
 * заказа, то есть показывала комментарии менеджера, а живые письма — нет.
 * Евгения Матвеева 02.10.2026: сначала «три одинаковых поля с комментариями»,
 * потом «пропали письма». Правда в том, что письма лежат в своих таблицах:
 *
 *  - входящие — `incoming_emails` (их разбирает Катерина, автоприём почты);
 *  - исходящие — `order_email_sends` (письма по заказу из карточки).
 *
 * Отсюда и собираем, а комментарии остаются там, где им место: в своём поле
 * карточки и в истории заказа.
 */
import { supabase } from '@/utils/supabase';

export type OrderMailEntry = {
    id: string;
    date: string | null;
    /** Человеческая подпись: «Входящее письмо» / «Исходящее письмо». */
    type: string;
    text: string;
    source: 'incoming' | 'outgoing';
    /** От кого или кому — чтобы письмо читалось без открытия. */
    party: string | null;
};

const preview = (value: unknown, limit = 600): string => {
    const text = String(value ?? '').replace(/ /g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/**
 * Письма по заказу, новые сверху.
 * Ищем по номеру заказа и по его идентификатору RetailCRM: входящие
 * привязываются и так, и так.
 */
export async function loadOrderMail(params: {
    orderNumber: string;
    orderId: number | string | null;
    limit?: number;
}): Promise<OrderMailEntry[]> {
    const number = String(params.orderNumber ?? '').trim();
    const orderId = params.orderId === null || params.orderId === undefined ? null : Number(params.orderId);
    const limit = params.limit ?? 20;

    if (!number && !orderId) return [];

    const incomingFilters = [
        number ? `created_crm_order_number.eq.${number}` : null,
        Number.isFinite(orderId) ? `linked_order_id.eq.${orderId}` : null,
    ].filter(Boolean) as string[];

    const [incoming, outgoing] = await Promise.all([
        incomingFilters.length
            ? supabase
                .from('incoming_emails')
                .select('id, subject, from_email, from_name, body_text, received_at, created_at')
                .or(incomingFilters.join(','))
                .order('received_at', { ascending: false })
                .limit(limit)
            : Promise.resolve({ data: [] as any[], error: null }),
        number || Number.isFinite(orderId)
            ? supabase
                .from('order_email_sends')
                .select('id, subject, to_email, created_at, order_number, order_id')
                .or([
                    number ? `order_number.eq.${number}` : null,
                    Number.isFinite(orderId) ? `order_id.eq.${orderId}` : null,
                ].filter(Boolean).join(','))
                .order('created_at', { ascending: false })
                .limit(limit)
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (incoming.error) console.warn('[order-mail] входящие не прочитались:', incoming.error.message);
    if (outgoing.error) console.warn('[order-mail] исходящие не прочитались:', outgoing.error.message);

    const entries: OrderMailEntry[] = [
        ...((incoming.data ?? []) as any[]).map((row) => ({
            id: `in-${row.id}`,
            date: row.received_at || row.created_at || null,
            type: 'Входящее письмо',
            party: row.from_name || row.from_email || null,
            text: [row.subject ? `Тема: ${row.subject}` : null, preview(row.body_text)].filter(Boolean).join('\n\n'),
            source: 'incoming' as const,
        })),
        ...((outgoing.data ?? []) as any[]).map((row) => ({
            id: `out-${row.id}`,
            date: row.created_at || null,
            type: 'Исходящее письмо',
            party: row.to_email || null,
            text: row.subject ? `Тема: ${row.subject}` : 'Письмо отправлено',
            source: 'outgoing' as const,
        })),
    ];

    return entries
        .sort((left, right) => String(right.date ?? '').localeCompare(String(left.date ?? '')))
        .slice(0, limit);
}
