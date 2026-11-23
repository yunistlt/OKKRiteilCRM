/**
 * Скачать вложение письма по заказу.
 *
 * Бинарь вложений мы не храним: письма читаются read-only. Поэтому при первом
 * обращении файл докачивается из ящика по UID письма и кладётся в наше
 * хранилище, а дальше отдаётся уже оттуда — второй раз в почту не ходим
 * (требование владельца 02.10.2026: «все файлы должны открываться»).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { ATTACHMENT_BUCKET, fileHeaders, loadLetterAttachment, safeStorageName } from '@/lib/email/attachment-file';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Путь в хранилище: заказ → письмо → файл. */
function storagePath(orderNumber: string, emailId: string, filename: string): string {
    return `order-files/${orderNumber}/${emailId}/${safeStorageName(filename)}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    // Номер своего заказа содержит кириллическую «А» («1020А») — в адресе он
    // приезжает закодированным.
    const orderNumber = decodeURIComponent(String(id)).trim();
    const url = new URL(request.url);
    const emailId = url.searchParams.get('emailId') || '';
    const filename = url.searchParams.get('name') || '';
    const fileId = url.searchParams.get('fileId') || '';

    // Файл, приложенный менеджером руками, лежит у нас — отдаём сразу.
    if (fileId) {
        const { data: row } = await supabase
            .from('order_files')
            .select('order_number, file_name, content_type, storage_bucket, storage_path, deleted_at')
            .eq('id', Number(fileId))
            .maybeSingle();

        const file = row as any;
        if (!file || file.deleted_at) {
            return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
        }
        if (String(file.order_number) !== orderNumber) {
            return NextResponse.json({ error: 'Этот файл не из этого заказа' }, { status: 403 });
        }

        const stored = await supabase.storage.from(file.storage_bucket).download(file.storage_path);
        if (!stored.data) {
            return NextResponse.json({ error: 'Файл не нашёлся в хранилище' }, { status: 404 });
        }

        const bytes = new Uint8Array(await stored.data.arrayBuffer());
        return new NextResponse(bytes, {
            headers: fileHeaders(file.file_name, bytes, file.content_type || stored.data.type),
        });
    }

    if (!emailId || !filename) {
        return NextResponse.json({ error: 'Нужны письмо и имя файла' }, { status: 400 });
    }

    // Письмо должно относиться к этому заказу — иначе по ссылке можно было бы
    // вытащить вложение чужого заказа.
    const { data: letter } = await supabase
        .from('incoming_emails')
        .select('id, subject, imap_uid, folder, created_crm_order_number, linked_order_id')
        .eq('id', emailId)
        .maybeSingle();

    if (!letter) return NextResponse.json({ error: 'Письмо не найдено' }, { status: 404 });

    // Письмо считается «по этому заказу», если так сказал автоприём
    // (created_crm_order_number / linked_order_id) или если в теме стоит наш
    // тег с этим номером.
    const { data: order } = await supabase
        .from('orders')
        .select('order_id')
        .eq('number', orderNumber)
        .maybeSingle();

    const belongs =
        String((letter as any).created_crm_order_number ?? '').trim() === orderNumber
        || (order?.order_id != null && String((letter as any).linked_order_id ?? '') === String((order as any).order_id))
        || String((letter as any).subject ?? '').includes(`/${orderNumber}]`);

    if (!belongs) {
        return NextResponse.json({ error: 'Это письмо не по этому заказу' }, { status: 403 });
    }

    const path = storagePath(orderNumber, emailId, filename);
    const loaded = await loadLetterAttachment(letter as any, filename, path);
    if (!loaded.ok) return loaded.response;

    /**
     * Вложение письма становится файлом заказа.
     *
     * Раньше оно оседало только в хранилище: открыть по ссылке можно, а во
     * вкладке «Файлы» его нет — значит нельзя ни приложить к ответу
     * галочкой, ни отправить в цех. Присланный клиентом чертёж — такой же
     * файл заказа, как загруженный руками.
     */
    if (loaded.fromMailbox) {
        const { data: known } = await supabase
            .from('order_files')
            .select('id')
            .eq('storage_path', path)
            .is('deleted_at', null)
            .maybeSingle();

        if (!known) {
            await supabase.from('order_files').insert({
                order_number: orderNumber,
                file_name: filename,
                content_type: loaded.contentType,
                size_bytes: loaded.bytes.length,
                storage_bucket: ATTACHMENT_BUCKET,
                storage_path: path,
                note: 'из письма клиента',
                uploaded_by: null,
                // В списке файлов показываем дату письма, а не момент докачки.
                source_at: loaded.receivedAt,
            });
        }
    }

    return new NextResponse(loaded.bytes, {
        headers: fileHeaders(filename, loaded.bytes, loaded.contentType),
    });
}
