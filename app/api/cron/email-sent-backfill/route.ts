/**
 * Разовый разбор СТАРЫХ писем папки «Отправленные».
 *
 * Обычный `email-sent-poll` идёт инкрементально по UID с момента включения, и
 * всё, что отправлялось раньше (в том числе письма эпохи RetailCRM), у нас не
 * лежит: в `outgoing_emails` 377 писем, из них почти все — с октября 2026.
 * Нужны именно старые — по ним достаём настоящие формулировки писем о переносе
 * сроков и о доплате остатка (задание владельца 14.10.2026).
 *
 * Читаем read-only через `fetchEmailsSince` (IMAP SINCE, флаг \Seen не трогаем),
 * пишем в ту же каноническую таблицу `outgoing_emails` с тем же ключом
 * (mailbox, folder, uid_validity, imap_uid) — повторный запуск ничего не
 * задваивает. Указатель `email_ingest_state` НЕ двигаем: он про новые письма,
 * а мы идём в прошлое.
 *
 * Локально не работает: IMAP из РФ режет DPI, запускать с прода.
 * `?since=2025-01-01` — с какой даты разбирать (по умолчанию год назад).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';
import { fetchEmailsSince, findSentFolder, isImapConfigured } from '@/lib/email/imap';
import { taggedOrderNumber } from '@/lib/email/order-tag';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

    const sinceParam = new URL(req.url).searchParams.get('since');
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(since.getTime())) {
        return NextResponse.json({ ok: false, error: 'bad_since' }, { status: 400 });
    }

    try {
        const emails = await fetchEmailsSince(since, folder);

        let linked = 0;
        const rows = emails.map((mail) => {
            const orderNumber = taggedOrderNumber(mail.subject);
            if (orderNumber) linked += 1;
            return {
                mailbox,
                folder,
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
            };
        });

        if (rows.length) {
            const { error } = await supabase
                .from('outgoing_emails')
                .upsert(rows, { onConflict: 'mailbox,folder,uid_validity,imap_uid' });
            if (error) throw new Error(error.message);
        }

        return NextResponse.json({
            ok: true,
            folder,
            since: since.toISOString(),
            fetched: rows.length,
            linkedToOrders: linked,
        });
    } catch (e: any) {
        console.error('[email-sent-backfill] сбой:', e.message);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
