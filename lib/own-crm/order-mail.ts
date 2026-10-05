/**
 * Переписка по заказу: настоящие письма, а не события истории RetailCRM.
 *
 * Лента «Письма и сообщения» в карточке раньше строилась только из истории
 * заказа, то есть показывала комментарии менеджера, а живые письма — нет.
 * Евгения Матвеева 02.10.2026: сначала «три одинаковых поля с комментариями»,
 * потом «пропали письма». Правда в том, что письма лежат в своих таблицах:
 *
 *  - входящие — `incoming_emails` (их разбирает Катерина, автоприём почты);
 *  - исходящие — `order_email_sends` (письма по заказу из карточки) и
 *    `outgoing_emails` (папка «Отправленные» ящика: там письма RetailCRM и
 *    переписка менеджеров через веб-почту).
 *
 * Третий путь привязки — **тег в теме**: наши письма по заказу уходят с
 * `[#магазин/номер]`, и он же возвращается в ответах клиента. По нему письмо
 * цепляется к заказу, даже если автоприём не проставил связь (так же делает
 * RetailCRM; решение владельца 02.10.2026: «письма очень важны»). На 02.10 в
 * ящике 1 506 писем с тегом, из них 931 без иной привязки.
 *
 * Комментарии остаются там, где им место: в своём поле карточки и в истории.
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
    /** Адрес собеседника — по нему карточка отвечает на письмо. */
    partyEmail: string | null;
    /** Тема отдельно: в ленте она заголовок, а не часть текста. */
    subject: string | null;
    /**
     * Письмо целиком. Евгения 02.10.2026: «как посмотреть письмо, которое я
     * отправила? видна только тема, внутрь никак не попасть» — поэтому тело
     * едет вместе с лентой и раскрывается по щелчку.
     */
    body: string | null;
    /** Сколько вложений — их открывают через «Файлы» заказа. */
    attachments: number;
};

/**
 * Текст письма из HTML. Часть писем приходит вообще без текстовой части —
 * у них заполнен только `body_html`, и лента показывала пустоту.
 */
const textFromHtml = (html: unknown): string =>
    String(html ?? '')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();

/** Текст письма: берём текстовую часть, а если её нет — вытаскиваем из HTML. */
const mailBody = (row: { body_text?: unknown; body_html?: unknown }): string | null => {
    const plain = String(row.body_text ?? '').trim();
    if (plain) return plain.replace(/ /g, ' ');
    const fromHtml = textFromHtml(row.body_html);
    return fromHtml ? fromHtml.replace(/ /g, ' ') : null;
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
        // Тег в теме: «[#2/49583] …» и ответы «Re: [#2/49583] …».
        number ? `subject.ilike.%/${number}]%` : null,
    ].filter(Boolean) as string[];

    const [incoming, outgoing, sent] = await Promise.all([
        incomingFilters.length
            ? supabase
                .from('incoming_emails')
                .select('id, subject, from_email, from_name, body_text, body_html, received_at, created_at, attachments_meta')
                .or(incomingFilters.join(','))
                .order('received_at', { ascending: false })
                .limit(limit)
            : Promise.resolve({ data: [] as any[], error: null }),
        number || Number.isFinite(orderId)
            ? supabase
                .from('order_email_sends')
                .select('id, subject, to_email, created_at, order_number, order_id, message_id, body_text')
                .or([
                    number ? `order_number.eq.${number}` : null,
                    Number.isFinite(orderId) ? `order_id.eq.${orderId}` : null,
                ].filter(Boolean).join(','))
                .order('created_at', { ascending: false })
                .limit(limit)
            : Promise.resolve({ data: [] as any[], error: null }),
        // Папка «Отправленные»: привязка по тегу темы или по номеру заказа.
        number
            ? supabase
                .from('outgoing_emails')
                .select('id, subject, to_email, sent_at, body_text, body_html, message_id, attachments_meta')
                .or(`order_number.eq.${number},subject.ilike.%/${number}]%`)
                .order('sent_at', { ascending: false })
                .limit(limit)
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (incoming.error) console.warn('[order-mail] входящие не прочитались:', incoming.error.message);
    if (outgoing.error) console.warn('[order-mail] исходящие не прочитались:', outgoing.error.message);
    if (sent.error) console.warn('[order-mail] «Отправленные» не прочитались:', sent.error.message);

    /**
     * Текст письма, отправленного из карточки: сама запись об отправке тела не
     * хранит, но это же письмо лежит в папке «Отправленные» — там и берём
     * (связь по message_id, иначе по теме).
     */
    const sentRows = ((sent.data ?? []) as any[]);
    const bodyByMessageId = new Map<string, any>();
    for (const row of sentRows) {
        if (row.message_id) bodyByMessageId.set(String(row.message_id), row);
    }

    const countAttachments = (meta: unknown) => (Array.isArray(meta) ? meta.length : 0);

    const entries: OrderMailEntry[] = [
        ...((incoming.data ?? []) as any[]).map((row) => ({
            id: `in-${row.id}`,
            date: row.received_at || row.created_at || null,
            type: 'Входящее письмо',
            party: row.from_name || row.from_email || null,
            partyEmail: row.from_email || null,
            subject: row.subject || null,
            body: mailBody(row),
            attachments: countAttachments(row.attachments_meta),
            text: [row.subject ? `Тема: ${row.subject}` : null, preview(mailBody(row))].filter(Boolean).join('\n\n'),
            source: 'incoming' as const,
        })),
        ...((outgoing.data ?? []) as any[]).map((row) => {
            const twin = row.message_id ? bodyByMessageId.get(String(row.message_id)) : null;
            // Свой текст надёжнее: он есть сразу после отправки, а копия из папки
            // «Отправленные» приезжает позже — её берём только для старых писем.
            const body = mailBody(row) ?? (twin ? mailBody(twin) : null);
            return {
                id: `out-${row.id}`,
                date: row.created_at || null,
                type: 'Исходящее письмо',
                party: row.to_email || null,
                partyEmail: row.to_email || null,
                subject: row.subject || null,
                body: body ? String(body).replace(/\u00a0/g, ' ').trim() : null,
                attachments: countAttachments(twin?.attachments_meta),
                text: row.subject ? `Тема: ${row.subject}` : 'Письмо отправлено',
                source: 'outgoing' as const,
            };
        }),
        ...sentRows
            // Если письмо уже показано записью об отправке, второй раз не выводим.
            .filter((row) => !((outgoing.data ?? []) as any[]).some((send: any) => send.message_id && String(send.message_id) === String(row.message_id)))
            .map((row) => ({
                id: `sent-${row.id}`,
                date: row.sent_at || null,
                type: 'Исходящее письмо',
                party: row.to_email || null,
                partyEmail: row.to_email || null,
                subject: row.subject || null,
                body: mailBody(row),
                attachments: countAttachments(row.attachments_meta),
                text: [row.subject ? `Тема: ${row.subject}` : null, preview(mailBody(row))].filter(Boolean).join('\n\n'),
                source: 'outgoing' as const,
            })),
    ];

    return entries
        .sort((left, right) => String(right.date ?? '').localeCompare(String(left.date ?? '')))
        .slice(0, limit);
}
