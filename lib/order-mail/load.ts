import { supabase } from '@/utils/supabase';
import { buildThreads, parseReferences, type MailMessage, type MailThread } from './thread';

/**
 * Письма заказа из всех трёх источников — и сразу тредами.
 *
 * Источники (ни один не канон целиком, поэтому читаем все):
 *  - `incoming_emails` — входящие, их разбирает автоприём Катерины;
 *  - `order_email_sends` — наши письма, отправленные из карточки заказа;
 *  - `outgoing_emails` — папка «Отправленные» ящика: там письма RetailCRM и
 *    переписка менеджеров через веб-почту.
 *
 * Наше письмо попадает и в `order_email_sends`, и (после синка) в
 * `outgoing_emails` — одно и то же письмо дважды. Склеиваем по `message_id`.
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

const bodyOf = (row: { body_text?: unknown; body_html?: unknown }): string | null => {
    const plain = String(row.body_text ?? '').trim();
    if (plain) return plain;
    const fromHtml = textFromHtml(row.body_html);
    return fromHtml || null;
};

/** Вложения письма из `attachments_meta`: формат у строк разный, берём мягко. */
function attachmentsOf(meta: unknown): Array<{ name: string; size: number | null }> {
    const list = Array.isArray(meta) ? meta : [];
    return list
        .map((item: any) => ({
            name: String(item?.filename ?? item?.name ?? '').trim(),
            size: Number.isFinite(Number(item?.size)) ? Number(item.size) : null,
        }))
        .filter((item) => item.name);
}

export type OrderMailResult = {
    threads: MailThread[];
    unread: number;
    total: number;
};

export async function loadOrderThreads(params: {
    orderNumber: string;
    orderId: number | null;
    /** Кто смотрит: прочитанность у каждого своя. */
    viewer: string;
    limit?: number;
}): Promise<OrderMailResult> {
    const number = String(params.orderNumber ?? '').trim();
    const orderId = Number.isFinite(Number(params.orderId)) ? Number(params.orderId) : null;
    const limit = params.limit ?? 100;
    if (!number) return { threads: [], unread: 0, total: 0 };

    // Входящее цепляется к заказу тремя способами, и ни один не покрывает всё.
    const incomingFilters = [
        `created_crm_order_number.eq.${number}`,
        orderId !== null ? `linked_order_id.eq.${orderId}` : null,
        // Наш тег в теме: «[#2/54905]» и ответы «Re: [#2/54905] …».
        `subject.ilike.%/${number}]%`,
    ].filter(Boolean) as string[];

    const [incomingRes, sentRes, mailboxRes, readsRes, threadsRes] = await Promise.all([
        supabase
            .from('incoming_emails')
            .select('id, message_id, in_reply_to, email_refs, subject, from_email, from_name, to_email, received_at, body_text, body_html, attachments_meta')
            .or(incomingFilters.join(','))
            .order('received_at', { ascending: false })
            .limit(limit),
        supabase
            .from('order_email_sends')
            .select('id, message_id, subject, to_email, created_at, body_text, body_html')
            .eq('order_number', number)
            .order('created_at', { ascending: false })
            .limit(limit),
        supabase
            .from('outgoing_emails')
            .select('id, message_id, subject, to_email, sent_at, body_text, body_html, attachments_meta')
            .or(`order_number.eq.${number},subject.ilike.%/${number}]%`)
            .order('sent_at', { ascending: false })
            .limit(limit),
        supabase
            .from('order_mail_reads')
            .select('message_key')
            .eq('order_number', number)
            .eq('read_by', params.viewer),
        supabase
            .from('order_mail_threads')
            .select('thread_key, state')
            .eq('order_number', number),
    ]);

    const readKeys = new Set(((readsRes.data ?? []) as any[]).map((row) => String(row.message_key)));
    const closedKeys = new Set(
        ((threadsRes.data ?? []) as any[])
            .filter((row) => row.state === 'closed')
            .map((row) => String(row.thread_key)),
    );

    const messages: MailMessage[] = [];

    for (const row of ((incomingRes.data ?? []) as any[])) {
        const key = `in:${row.id}`;
        messages.push({
            key,
            direction: 'in',
            messageId: row.message_id ?? null,
            inReplyTo: row.in_reply_to ?? null,
            references: parseReferences(row.email_refs),
            subject: row.subject ?? null,
            from: row.from_email ?? null,
            fromName: row.from_name ?? null,
            to: row.to_email ?? null,
            at: row.received_at ?? null,
            body: bodyOf(row),
            attachments: attachmentsOf(row.attachments_meta),
            sourceId: String(row.id),
            read: readKeys.has(key),
        });
    }

    // Наши письма: сначала журнал отправок, он появляется сразу при отправке.
    const ourMessageIds = new Set<string>();
    for (const row of ((sentRes.data ?? []) as any[])) {
        const key = `out:${row.id}`;
        if (row.message_id) ourMessageIds.add(String(row.message_id).replace(/^<|>$/g, '').toLowerCase());
        messages.push({
            key,
            direction: 'out',
            messageId: row.message_id ?? null,
            inReplyTo: null,
            references: [],
            subject: row.subject ?? null,
            from: null,
            fromName: null,
            to: row.to_email ?? null,
            at: row.created_at ?? null,
            body: bodyOf(row),
            attachments: [],
            sourceId: String(row.id),
            // Своё письмо человек видел, когда отправлял.
            read: true,
        });
    }

    for (const row of ((mailboxRes.data ?? []) as any[])) {
        // То же письмо уже взято из журнала отправок — второй раз не показываем.
        const id = String(row.message_id ?? '').replace(/^<|>$/g, '').toLowerCase();
        if (id && ourMessageIds.has(id)) continue;
        messages.push({
            key: `box:${row.id}`,
            direction: 'out',
            messageId: row.message_id ?? null,
            inReplyTo: null,
            references: [],
            subject: row.subject ?? null,
            from: null,
            fromName: null,
            to: row.to_email ?? null,
            at: row.sent_at ?? null,
            body: bodyOf(row),
            attachments: attachmentsOf(row.attachments_meta),
            sourceId: String(row.id),
            read: true,
        });
    }

    const threads = buildThreads(messages, closedKeys);

    return {
        threads,
        unread: threads.reduce((sum, thread) => sum + thread.unread, 0),
        total: messages.length,
    };
}
