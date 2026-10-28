import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { isImapConfigured } from '@/lib/email/imap';
import { fileContentType } from '@/lib/file-type';

export const dynamic = 'force-dynamic';

/**
 * Файлы заказа: вложения писем плюс то, что менеджер приложил руками.
 *
 * Сами файлы в базе не лежат — письма мы читаем read-only и бинарь не храним.
 * Но открыть их можно: по кнопке файл докачивается из ящика по UID письма и
 * кладётся в наше хранилище (`/api/orders/[id]/files/download`), поэтому
 * каждому вложению отдаём `emailId` и имя — по ним и качаем.
 * Требование владельца 02.10.2026: «все файлы заказа должны открываться».
 *
 * Приложенные руками файлы лежат у нас (`order_files` + бакет `okk-assets`) и
 * отдаются ссылкой сразу — просьба Евгении 02.10.2026: счёт из RetailCRM надо
 * иметь при заказе в ОКК.
 */
/**
 * Откуда файл взялся — человеческой строкой для колонки «Источник».
 *
 * В базе источник записан по-разному: пометкой (`note`), кем приложен
 * (`uploaded_by`), а у вложений писем — только темой самого письма. В списке
 * человек должен видеть одно понятное слово, а не служебную пометку.
 */
/**
 * Номер письма из пути хранения: `order-files/<заказ>/<письмо>/<файл>`.
 *
 * Так лежат вложения, которые мы забрали из своего ящика. По этому номеру
 * колонка «Источник» открывает переписку заказа.
 */
function mailIdFromPath(storagePath: string | null): string | null {
    const parts = String(storagePath ?? '').split('/');
    return parts[0] === 'order-files' && parts.length >= 4 ? parts[2] : null;
}

function fileOrigin(note: string | null, uploadedBy: string | null): string {
    const mark = String(note ?? '').trim();
    const who = String(uploadedBy ?? '').trim();

    // Письмо осталось в RetailCRM: у нас его нет, открывать нечего — так и
    // пишем, чтобы подпись не выглядела сломанной ссылкой.
    if (mark.startsWith('Вложение письма RetailCRM')) return 'Письмо в RetailCRM';
    if (mark.startsWith('Вложение письма')) return 'Письмо';
    if (mark.startsWith('Файл заказа из RetailCRM')) return 'Перенос из RetailCRM';
    if (mark.startsWith('из письма клиента')) return 'Письмо клиента';
    if (mark.startsWith('Взят из заказа')) return mark;
    if (who && who !== 'RetailCRM' && who !== 'Перенесено из RetailCRM') return `Приложил ${who}`;

    return mark || 'Приложен вручную';
}

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

    // Приложенные руками — отдельной выборкой: это наши файлы, а не почтовые.
    const { data: manual } = await supabase
        .from('order_files')
        .select('id, file_name, content_type, size_bytes, note, uploaded_by, created_at, source_at, storage_path')
        .eq('order_number', orderNumber)
        .is('deleted_at', null)
        // Архивные в рабочем списке не показываем: они остаются в разделе «Файлы».
        .is('archived_at', null)
        .order('created_at', { ascending: false });

    const manualFiles = ((manual as any[]) ?? []).map((row) => ({
        source: 'manual' as const,
        fileId: row.id,
        filename: row.file_name,
        size: row.size_bytes ?? null,
        // Тип у вложений, долитых из RetailCRM, не записан: выводим по имени,
        // иначе в списке не будет значка формата.
        contentType: row.content_type ?? fileContentType(row.file_name),
        note: row.note ?? null,
        uploadedBy: row.uploaded_by ?? null,
        /** Откуда файл взялся — одной строкой, как в RetailCRM. */
        origin: fileOrigin(row.note, row.uploaded_by),
        /**
         * Письмо, из которого файл приехал, — чтобы источник открывался.
         * У вложений, забранных из нашего ящика, номер письма зашит в пути
         * хранения. У перенесённых из RetailCRM письма у нас нет вовсе, и
         * открывать нечего — такие остаются просто подписью.
         */
        mailId: mailIdFromPath(row.storage_path),
        // У файла из письма показываем дату письма: иначе вложение
        // полугодовой давности выглядит сегодняшним (Андрей, 27.10.2026).
        receivedAt: row.source_at ?? row.created_at,
        downloadable: true,
    }));

    /**
     * Вложение письма, уже сохранённое у нас, вторым разом не показываем.
     *
     * Вложения забирает крон (`lib/email/attachments.ts`) и кладёт в
     * `order_files`, а список рисовал ещё и строку из самого письма — один
     * файл выходил дважды, «приложил …» и «от …» (доработка №27,
     * Евгения Матвеева, 22.10.2026). Ключ — имя плюс размер: так же, как
     * проверяет сам крон перед записью.
     */
    const storedKeys = new Set(
        manualFiles.map((file) => `${String(file.filename).trim().toLowerCase()}|${file.size ?? ''}`)
    );
    const alreadyStored = (att: any) => {
        const name = String(att?.filename ?? '').trim().toLowerCase();
        const size = Number(att?.size) || null;
        return storedKeys.has(`${name}|${size ?? ''}`) || storedKeys.has(`${name}|`);
    };

    const files = ((data as any[]) ?? []).flatMap((letter) =>
        (Array.isArray(letter.attachments_meta) ? letter.attachments_meta : [])
            .filter((att: any) => !alreadyStored(att))
            .map((att: any) => ({
            emailId: letter.id,
            filename: att?.filename || 'Без имени',
            size: Number(att?.size) || null,
            contentType: att?.contentType || null,
            fromEmail: letter.from_email,
            fromName: letter.from_name,
            subject: letter.subject,
            // В RetailCRM источником вложения показана тема его письма — так
            // видно, в каком разговоре файл пришёл.
            origin: String(letter.subject ?? '').trim() || 'Письмо',
            receivedAt: letter.received_at,
            /** Можно ли открыть: письмо ещё лежит в ящике и к нему есть доступ. */
            downloadable: Boolean(isImapConfigured() && letter.imap_uid),
            source: 'email' as const,
        }))
    );

    return NextResponse.json({
        ok: true,
        files: [...manualFiles, ...files],
        imapConfigured: isImapConfigured(),
    });
}

/**
 * Взять файл из другого заказа.
 *
 * Паспорта изделий лежат в тех заказах, где их когда-то прикладывали, а нужны
 * они в каждом новом (Женя Матвеева 12.10.2026). Копируем только запись: сам
 * файл уже в хранилище, второй раз его заливать незачем.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    const body = await req.json().catch(() => null);
    const fileId = Number(body?.fileId);
    if (String(body?.action) !== 'copy' || !Number.isFinite(fileId)) {
        return NextResponse.json({ error: 'Непонятно, что приложить' }, { status: 400 });
    }

    const { data: source } = await supabase
        .from('order_files')
        .select('order_number, file_name, content_type, size_bytes, storage_bucket, storage_path')
        .eq('id', fileId)
        .is('deleted_at', null)
        .maybeSingle();

    if (!source) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

    const file = source as any;
    if (String(file.order_number) === orderNumber) {
        return NextResponse.json({ ok: true, message: 'Этот файл уже в заказе' });
    }

    // Второй раз тот же файл в заказ не кладём.
    const { data: already } = await supabase
        .from('order_files')
        .select('id')
        .eq('order_number', orderNumber)
        .eq('storage_path', file.storage_path)
        .is('deleted_at', null)
        .maybeSingle();

    if (already) return NextResponse.json({ ok: true, message: 'Этот файл уже в заказе' });

    const { error } = await supabase.from('order_files').insert({
        order_number: orderNumber,
        file_name: file.file_name,
        content_type: file.content_type,
        size_bytes: file.size_bytes,
        storage_bucket: file.storage_bucket,
        storage_path: file.storage_path,
        uploaded_by: session.user.email || session.user.username || null,
        note: `Взят из заказа №${file.order_number}`,
    });

    if (error) return NextResponse.json({ error: `Не удалось приложить: ${error.message}` }, { status: 500 });

    return NextResponse.json({ ok: true, message: `Файл приложен — взят из заказа №${file.order_number}` });
}
