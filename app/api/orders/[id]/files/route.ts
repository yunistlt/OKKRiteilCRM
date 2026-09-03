import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Вложения, пришедшие с письмами по заказу.
 *
 * ВАЖНО: у нас хранится только опись вложения (имя, тип, размер) — сами файлы приёмщик
 * почты не скачивает, они остаются в ящике rop@zmktlt.ru. Поэтому отдаём список без ссылок
 * и честно говорим об этом в интерфейсе, а не делаем вид, что файл можно открыть.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { id } = await params;
    const orderNumber = String(id);

    const { data, error } = await supabase
        .from('incoming_emails')
        .select('subject, from_email, from_name, received_at, attachments_meta')
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
            filename: att?.filename || 'Без имени',
            size: Number(att?.size) || null,
            contentType: att?.contentType || null,
            fromEmail: letter.from_email,
            fromName: letter.from_name,
            subject: letter.subject,
            receivedAt: letter.received_at,
        }))
    );

    return NextResponse.json({ ok: true, files });
}
