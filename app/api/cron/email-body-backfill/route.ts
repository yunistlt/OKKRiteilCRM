import { NextResponse } from 'next/server';
import { isCronHeaderAuthorized } from '@/lib/cron-auth';
import { supabase } from '@/utils/supabase';
import { fetchEmailContentByUid } from '@/lib/email/imap';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Разовый добор текстов писем из ящика.
 *
 * Письма, отправленные до 02.10.2026, уходили одним HTML без текстовой части, а
 * синк «Отправленных» HTML не сохранял — в ленте заказа у них пусто. Текст при
 * этом лежит в самом ящике: берём его по UID и дописываем в нашу запись.
 *
 * Идёт пачками, чтобы уложиться в лимит выполнения: гоняем, пока в ответе
 * `left > 0`. Письма не помечаются прочитанными (BODY.PEEK).
 */
const BATCH = 40;

/** Сколько писем ещё без текста в таблице. */
async function pending(table: string): Promise<number> {
    const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .is('body_text', null)
        .is('body_html', null)
        .not('imap_uid', 'is', null);
    return count ?? 0;
}

/** Исходящие добираем первыми: по ним жалуются менеджеры. */
async function nextTable(): Promise<string> {
    return (await pending('outgoing_emails')) > 0 ? 'outgoing_emails' : 'incoming_emails';
}

export async function GET(req: Request) {
    if (!isCronHeaderAuthorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const asked = searchParams.get('table');
    // Планировщик зовёт без параметров: сперва добираем исходящие, а когда они
    // кончились — входящие. Так один заход расписания закрывает оба ящика.
    const table = asked === 'incoming' ? 'incoming_emails' : asked === 'outgoing' ? 'outgoing_emails' : await nextTable();
    const folder = searchParams.get('folder') || (table === 'incoming_emails' ? 'INBOX' : 'Sent');

    const { data: rows, error } = await supabase
        .from(table)
        .select('id, imap_uid, folder')
        .is('body_text', null)
        .is('body_html', null)
        .not('imap_uid', 'is', null)
        .order('id', { ascending: false })
        .limit(BATCH);

    if (error) {
        console.error('[email-backfill] выборка не прочиталась:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let filled = 0;
    let missing = 0;

    for (const row of (rows || []) as any[]) {
        try {
            const mail = await fetchEmailContentByUid(Number(row.imap_uid), row.folder || folder);
            if (!mail || (!mail.bodyText && !mail.bodyHtml)) {
                missing += 1;
                continue;
            }
            await supabase
                .from(table)
                .update({ body_text: mail.bodyText, body_html: mail.bodyHtml })
                .eq('id', row.id);
            filled += 1;
        } catch (e: any) {
            console.error('[email-backfill] письмо не добралось:', row.id, e?.message || e);
            missing += 1;
        }
    }

    return NextResponse.json({
        ok: true,
        table,
        filled,
        missing,
        left: await pending(table),
        leftIncoming: await pending('incoming_emails'),
        leftOutgoing: await pending('outgoing_emails'),
    });
}
