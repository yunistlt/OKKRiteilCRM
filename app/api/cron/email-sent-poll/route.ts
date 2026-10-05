/**
 * Чтение папки «Отправленные» ящика rop@zmktlt.ru.
 *
 * Входящие читает email-poll, а исходящих у нас не было вовсе: письма, которые
 * отправляла сама RetailCRM (уведомления по статусу) и менеджеры через
 * веб-почту, в INBOX не попадают. Поэтому в карточке заказа 49583 семь писем
 * было видно в RetailCRM и не видно у нас (замечание владельца 02.10.2026).
 *
 * Как и входящие: read-only, инкрементально по UID (`email_ingest_state`,
 * своя строка на папку), флаг \Seen не трогаем. К заказу письмо цепляем по
 * тегу темы «[#магазин/номер]» — его ставим мы сами, и он же стоит в письмах
 * RetailCRM.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { fetchNewEmails, findSentFolder, isImapConfigured } from '@/lib/email/imap';
import { taggedOrderNumber } from '@/lib/email/order-tag';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BATCH = 50;

function hasCronAuthorization(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
    const cronAuthorized = hasCronAuthorization(req);
    const session = cronAuthorized ? null : await getSession();
    if (!cronAuthorized && !hasAnyRole(session, ['admin', 'rop'])) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isImapConfigured()) {
        return NextResponse.json({ ok: false, error: 'imap_not_configured' });
    }

    const mailbox = process.env.IMAP_USER || process.env.SMTP_USER || '';
    const folder = await findSentFolder();

    if (!folder) {
        return NextResponse.json({ ok: false, error: 'sent_folder_not_found' });
    }

    try {
        const { data: stateRow } = await supabase
            .from('email_ingest_state')
            .select('last_seen_uid, uid_validity')
            .eq('mailbox', mailbox)
            .eq('folder', folder)
            .maybeSingle();

        const lastSeenUid = Number(stateRow?.last_seen_uid ?? 0);
        const knownUidValidity = stateRow?.uid_validity != null ? Number(stateRow.uid_validity) : null;

        const result = await fetchNewEmails({
            folder,
            lastSeenUid,
            knownUidValidity,
            maxBatch: MAX_BATCH,
            // Холодный старт: берём хвост, а не всю историю ящика.
            coldStartTailOnly: true,
        });

        let saved = 0;
        let linked = 0;

        if (result.emails.length) {
            const rows = result.emails.map((mail) => {
                const orderNumber = taggedOrderNumber(mail.subject);
                if (orderNumber) linked += 1;
                return {
                    mailbox,
                    folder,
                    imap_uid: mail.imapUid,
                    uid_validity: result.uidValidity,
                    message_id: mail.messageId,
                    subject: mail.subject,
                    from_email: mail.fromEmail,
                    to_email: mail.toEmail,
                    sent_at: mail.receivedAt,
                    body_text: mail.bodyText,
                    // Часть писем уходит одним HTML — без него в ленте заказа пусто.
                    body_html: mail.bodyHtml,
                    has_attachments: mail.hasAttachments,
                    attachments_meta: mail.attachmentsMeta ?? [],
                    order_number: orderNumber,
                };
            });

            const { error } = await supabase
                .from('outgoing_emails')
                .upsert(rows, { onConflict: 'mailbox,folder,uid_validity,imap_uid' });

            if (error) throw new Error(error.message);
            saved = rows.length;
        }

        await supabase.from('email_ingest_state').upsert(
            {
                mailbox,
                folder,
                uid_validity: result.uidValidity,
                last_seen_uid: Math.max(result.maxUidFetched, lastSeenUid),
                last_run_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'mailbox,folder' },
        );

        return NextResponse.json({
            ok: true,
            folder,
            saved,
            // Сколько из них удалось привязать к заказу по тегу темы.
            linkedToOrders: linked,
            lastSeenUid: Math.max(result.maxUidFetched, lastSeenUid),
        });
    } catch (e: any) {
        console.error('[email-sent-poll] сбой:', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
