/**
 * Забирает вложения писем из ящика в наше хранилище.
 *
 * Андрей 14.10.2026: «надо значит хранить и вложения». Раньше у нас была только
 * опись: пока письмо живо в ящике — файл открывался, почистили ящик — вложение
 * потеряно, и в поиске по файлам его нет.
 *
 * Отдельным проходом, а не в приёме почты: приём разбирает заявки и заводит
 * заказы, и ронять его из-за тяжёлого вложения нельзя. Идёт пачками — гоняем,
 * пока в ответе `left > 0`. Письма не помечаются прочитанными (BODY.PEEK).
 */
import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { supabase } from '@/utils/supabase';
import { isImapConfigured } from '@/lib/email/imap';
import { storePendingAttachments } from '@/lib/email/attachments';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Вложения тяжёлые: берём помалу, чтобы уложиться в лимит выполнения. */
const BATCH = 10;

export async function GET(req: Request) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (!isImapConfigured()) {
        return NextResponse.json({ ok: true, skipped: 'Ящик не настроен' });
    }

    try {
        const result = await storePendingAttachments(BATCH);

        const { count } = await supabase
            .from('incoming_emails')
            .select('id', { count: 'exact', head: true })
            .eq('has_attachments', true)
            .is('attachments_stored_at', null);

        return NextResponse.json({ ok: true, ...result, left: count ?? 0 });
    } catch (error: any) {
        console.error('[email-attachments] проход не отработал:', error);
        return NextResponse.json({ error: String(error?.message ?? error) }, { status: 500 });
    }
}
