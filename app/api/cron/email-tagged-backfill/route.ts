/**
 * Ночной перенос старой переписки в заказы.
 *
 * Письма ящика с тегом `[#N/<номер>]` за последние 18 месяцев ложатся в
 * `incoming_emails` / `outgoing_emails` со связкой с заказом — после этого
 * старые сделки показывают переписку, а штатный разбор вложений
 * (`/api/cron/email-attachments`) забирает их файлы в заказ.
 *
 * Почему ночью: 12 тысяч писем — это около 330 МБ тел, а диск базы слабый
 * (ЗАКОН 16.10.2026, массовые правки в рабочее время запрещены).
 *
 * Гоняем, пока в ответе `left > 0`; закончив, проход становится холостым.
 */
import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { isImapConfigured } from '@/lib/email/imap';
import { backfillTaggedMail } from '@/lib/email/tagged-backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Писем за заход на папку. Тела тяжёлые, разбор идёт в память. */
const BATCH = 100;

export async function GET(req: Request) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!isImapConfigured()) {
        return NextResponse.json({ ok: true, skipped: 'Ящик не настроен' });
    }

    const result = await backfillTaggedMail(BATCH);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
