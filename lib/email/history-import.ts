/**
 * «Загрузить историю» — точечный подъём старой переписки по одному заказу.
 *
 * Зачем: автоприём почты начал работать 28.06.2026, и всё, что писалось
 * раньше, в нашей базе не лежит — по заказу 53083 запрос от 21.04.2026, КП и
 * переписка были, а во вкладке «Письма» пусто (доработка №34, Евгения
 * Матвеева, 22.10.2026). Весь ящик назад не разбираем: там 159 тысяч писем.
 * Менеджер нажимает кнопку по конкретной сделке — поднимаем переписку только
 * с адресами этого клиента.
 *
 * Ящик читается read-only, флаг «прочитано» не трогаем. Письма кладём в те же
 * канонические таблицы (`incoming_emails`, `outgoing_emails`) — четвёртой
 * таблицы под историю не заводим (docs/order-mail/OVERVIEW.md).
 *
 * Старые входящие НЕ идут к Катерине на разбор: статус сразу `archived` и
 * связка с заказом проставлена. Иначе письмо полугодовой давности завело бы
 * новую заявку.
 *
 * Локально не работает: IMAP из РФ режет DPI — проверять на проде.
 */
import { supabase } from '@/utils/supabase';
import { fetchEmailsByAddresses, findSentFolder, isImapConfigured } from '@/lib/email/imap';

export type HistoryImportResult = {
    ok: boolean;
    /** Почему не вышло — человеческим языком, для интерфейса. */
    error?: string;
    addresses: string[];
    /** Сколько писем нашлось в ящике и сколько из них было новыми для нас. */
    found: number;
    addedIncoming: number;
    addedOutgoing: number;
};

/** Адреса клиента по заказу: из самого заказа и из карточки клиента. */
export async function clientAddresses(orderNumber: string): Promise<string[]> {
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload')
        .eq('number', orderNumber)
        .maybeSingle();

    const payload = (order as any)?.raw_payload ?? {};
    const found = new Set<string>();
    const add = (value: unknown) => {
        const email = String(value ?? '').trim().toLowerCase();
        if (email.includes('@')) found.add(email);
    };

    add(payload.email);
    add(payload.customer?.email);
    for (const contact of (payload.contragent?.contacts ?? [])) add(contact?.email);

    const customerId = Number(payload.customer?.id ?? 0);
    if (customerId > 0) {
        const { data: client } = await supabase
            .from('clients')
            .select('email, contact_email, doubleemail')
            .eq('id', customerId)
            .maybeSingle();
        add((client as any)?.email);
        add((client as any)?.contact_email);
        add((client as any)?.doubleemail);
    }

    return Array.from(found);
}

/**
 * Поднять переписку с адресами клиента и привязать её к заказу.
 *
 * `maxMessages` — потолок на папку: тянем самые свежие письма из найденных,
 * чтобы запрос укладывался в время маршрута.
 */
export async function importOrderMailHistory(params: {
    orderNumber: string;
    orderId: number | null;
    maxMessages?: number;
}): Promise<HistoryImportResult> {
    const orderNumber = String(params.orderNumber).trim();
    const empty = { found: 0, addedIncoming: 0, addedOutgoing: 0 };

    if (!isImapConfigured()) {
        return { ok: false, error: 'Доступ к почтовому ящику не настроен', addresses: [], ...empty };
    }

    const addresses = await clientAddresses(orderNumber);
    if (!addresses.length) {
        return {
            ok: false,
            error: 'У заказа и карточки клиента нет почты — не знаем, чью переписку искать',
            addresses: [],
            ...empty,
        };
    }

    const mailbox = process.env.IMAP_USER || process.env.SMTP_USER || '';
    const maxMessages = params.maxMessages ?? 100;

    const inbox = await fetchEmailsByAddresses(addresses, { folder: 'INBOX', maxMessages });
    const sentFolder = await findSentFolder();
    const sent = sentFolder
        ? await fetchEmailsByAddresses(addresses, { folder: sentFolder, maxMessages })
        : [];

    let addedIncoming = 0;
    let addedOutgoing = 0;

    if (inbox.length) {
        // Что уже лежит у нас — по UID этой папки: второй раз письмо не кладём.
        const { data: known } = await supabase
            .from('incoming_emails')
            .select('imap_uid')
            .eq('mailbox', mailbox)
            .eq('folder', 'INBOX')
            .in('imap_uid', inbox.map((mail) => mail.imapUid));
        const seen = new Set(((known ?? []) as any[]).map((row) => Number(row.imap_uid)));

        const rows = inbox
            .filter((mail) => !seen.has(mail.imapUid))
            .map((mail) => ({
                message_id: mail.messageId,
                mailbox,
                folder: 'INBOX',
                imap_uid: mail.imapUid,
                uid_validity: mail.uidValidity,
                from_email: mail.fromEmail,
                from_name: mail.fromName,
                to_email: mail.toEmail,
                to_emails: mail.toEmails?.length ? mail.toEmails : null,
                cc_emails: mail.ccEmails?.length ? mail.ccEmails : null,
                subject: mail.subject,
                in_reply_to: mail.inReplyTo,
                email_refs: mail.references,
                received_at: mail.receivedAt,
                body_text: mail.bodyText,
                body_html: mail.bodyHtml,
                has_attachments: mail.hasAttachments,
                attachments_meta: mail.attachmentsMeta,
                // Разбирать старое письмо нечего: заказ уже есть и указан.
                status: 'archived',
                linked_order_id: params.orderId,
                created_crm_order_number: orderNumber,
            }));

        if (rows.length) {
            const { error } = await supabase.from('incoming_emails').insert(rows);
            if (error) {
                console.warn('[mail-history] входящие не записались:', error.message);
            } else {
                addedIncoming = rows.length;
            }
        }
    }

    if (sent.length && sentFolder) {
        const rows = sent.map((mail) => ({
            mailbox,
            folder: sentFolder,
            imap_uid: mail.imapUid,
            uid_validity: mail.uidValidity,
            message_id: mail.messageId,
            subject: mail.subject,
            from_email: mail.fromEmail,
            to_email: mail.toEmail,
            sent_at: mail.receivedAt,
            body_text: mail.bodyText,
            body_html: mail.bodyHtml,
            has_attachments: mail.hasAttachments,
            attachments_meta: mail.attachmentsMeta ?? [],
            order_number: orderNumber,
        }));

        const { error } = await supabase
            .from('outgoing_emails')
            .upsert(rows, { onConflict: 'mailbox,folder,uid_validity,imap_uid' });
        if (error) {
            console.warn('[mail-history] исходящие не записались:', error.message);
        } else {
            addedOutgoing = rows.length;
        }
    }

    return {
        ok: true,
        addresses,
        found: inbox.length + sent.length,
        addedIncoming,
        addedOutgoing,
    };
}
