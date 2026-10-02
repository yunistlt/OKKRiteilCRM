import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { isImapConfigured } from '@/lib/email/imap';

export const dynamic = 'force-dynamic';

/**
 * Файлы заказа: вложения писем, пришедших по нему.
 *
 * Сами файлы в базе не лежат — письма мы читаем read-only и бинарь не храним.
 * Но открыть их можно: по кнопке файл докачивается из ящика по UID письма и
 * кладётся в наше хранилище (`/api/orders/[id]/files/download`), поэтому
 * каждому вложению отдаём `emailId` и имя — по ним и качаем.
 * Требование владельца 02.10.2026: «все файлы заказа должны открываться».
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;
    const orderNumber = String(id);

    const { data, error } = await supabase
        .from('incoming_emails')
        .select('id, subject, from_email, from_name, received_at, attachments_meta, imap_uid, folder')
        .eq('has_attachments', true)
        .or(`created_crm_order_number.eq.${orderNumber},subject.ilike.%/${orderNumber}]%`)
        .order('received_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('[order-files] Не удалось прочитать вложения:', error);
        return NextResponse.json({ error: 'read_failed' }, { status: 500 });
    }

    const files = ((data as any[]) ?? []).flatMap((letter) =>
        (Array.isArray(letter.attachments_meta) ? letter.attachments_meta : []).map((att: any) => ({
            emailId: letter.id,
            filename: att?.filename || 'Без имени',
            size: Number(att?.size) || null,
            contentType: att?.contentType || null,
            fromEmail: letter.from_email,
            fromName: letter.from_name,
            subject: letter.subject,
            receivedAt: letter.received_at,
            /** Можно ли открыть: письмо ещё лежит в ящике и к нему есть доступ. */
            downloadable: Boolean(isImapConfigured() && letter.imap_uid),
        }))
    );

    return NextResponse.json({ ok: true, files, imapConfigured: isImapConfigured() });
}
