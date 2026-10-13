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
import { fetchEmailContentByUid, isImapConfigured } from '@/lib/email/imap';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'okk-assets';

/** Путь в хранилище: заказ → письмо → файл. Латиницу имени не трогаем, остальное чистим. */
function storagePath(orderNumber: string, emailId: string, filename: string): string {
    const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    return `order-files/${orderNumber}/${emailId}/${safe}`;
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

        const buffer = Buffer.from(await stored.data.arrayBuffer());
        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                'Content-Type': file.content_type || stored.data.type || 'application/octet-stream',
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
                'Cache-Control': 'private, max-age=600',
            },
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

    // 1) Уже скачивали — отдаём из хранилища.
    const cached = await supabase.storage.from(BUCKET).download(path);
    if (cached.data) {
        const buffer = Buffer.from(await cached.data.arrayBuffer());
        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                'Content-Type': cached.data.type || 'application/octet-stream',
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
                'Cache-Control': 'private, max-age=600',
            },
        });
    }

    // 2) Иначе качаем из ящика по UID письма.
    if (!isImapConfigured() || !(letter as any).imap_uid) {
        return NextResponse.json(
            { error: 'Файл остался в почте, а доступ к ящику не настроен — открыть нельзя' },
            { status: 409 },
        );
    }

    try {
        const mail = await fetchEmailContentByUid(
            Number((letter as any).imap_uid),
            String((letter as any).folder || 'INBOX'),
        );
        const attachment = (mail?.attachments ?? []).find(
            (a) => String(a.filename ?? '').trim() === filename.trim(),
        ) ?? (mail?.attachments ?? [])[0];

        if (!attachment?.content) {
            return NextResponse.json({ error: 'В письме такого вложения уже нет' }, { status: 404 });
        }

        const contentType = attachment.contentType || 'application/octet-stream';
        await supabase.storage
            .from(BUCKET)
            .upload(path, attachment.content, { contentType, upsert: true })
            .catch(() => undefined);

        /**
         * Вложение письма становится файлом заказа.
         *
         * Раньше оно оседало только в хранилище: открыть по ссылке можно, а во
         * вкладке «Файлы» его нет — значит нельзя ни приложить к ответу
         * галочкой, ни отправить в цех. Присланный клиентом чертёж — такой же
         * файл заказа, как загруженный руками.
         */
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
                content_type: contentType,
                size_bytes: attachment.content.length,
                storage_bucket: BUCKET,
                storage_path: path,
                note: 'из письма клиента',
                uploaded_by: null,
            });
        }

        return new NextResponse(new Uint8Array(attachment.content), {
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
                'Cache-Control': 'private, max-age=600',
            },
        });
    } catch (e: any) {
        console.error('[order-files/download] не смог забрать вложение:', e.message);
        return NextResponse.json({ error: `Не удалось забрать файл из почты: ${e.message}` }, { status: 502 });
    }
}
