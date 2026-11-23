/**
 * Вложение входящего письма — по самому письму, без заказа.
 *
 * Раздел «Письма» показывает всю почту компании всем, кому раздел открыт
 * (решение владельца 02.10.2026), — значит и файлы письма им видеть можно:
 * текст письма уже на экране, а вложение — его часть. Права на сам маршрут —
 * те же, что у раздела (`/api/emails` в `lib/rbac.ts`).
 *
 * Нужен для писем, не привязанных к заказу: раньше их вложения были просто
 * именами без ссылки (жалоба 23.11.2026 — «как посмотреть вложения, если
 * письмо без заказа»). Письмо с заказом открывает файл через заказ — там
 * вложение заодно ложится в файлы заказа.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { fileHeaders, loadLetterAttachment, safeStorageName } from '@/lib/email/attachment-file';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const url = new URL(request.url);
    const emailId = (url.searchParams.get('emailId') || '').trim();
    const filename = url.searchParams.get('name') || '';

    // id входящего письма — UUID; что-то другое в базу не отправляем.
    if (!/^[0-9a-f-]{36}$/i.test(emailId) || !filename) {
        return NextResponse.json({ error: 'Нужны письмо и имя файла' }, { status: 400 });
    }

    const { data: letter } = await supabase
        .from('incoming_emails')
        .select('id, imap_uid, folder')
        .eq('id', emailId)
        .maybeSingle();

    if (!letter) return NextResponse.json({ error: 'Письмо не найдено' }, { status: 404 });

    const path = `email-files/${emailId}/${safeStorageName(filename)}`;
    const loaded = await loadLetterAttachment(letter as any, filename, path);
    if (!loaded.ok) return loaded.response;

    return new NextResponse(loaded.bytes, {
        headers: fileHeaders(filename, loaded.bytes, loaded.contentType),
    });
}
