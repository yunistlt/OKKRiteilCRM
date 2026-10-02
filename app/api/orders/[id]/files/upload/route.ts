/**
 * Приложить файл к заказу руками.
 *
 * Евгения Матвеева 02.10.2026: счёт она выставила в RetailCRM и хочет
 * приложить его к заказу в ОКК. До этого в файлах заказа были только вложения
 * писем. Бинарь кладём в бакет `okk-assets` (тот же, куда складываются
 * докачанные вложения), запись — в `order_files`.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'okk-assets';
/** Больше 25 МБ в заказ не кладём: такие файлы отправляют ссылкой. */
const MAX_BYTES = 25 * 1024 * 1024;

function storagePath(orderNumber: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    return `order-files/${orderNumber}/manual/${Date.now()}-${safe}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Файл не получен' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
        return NextResponse.json({ error: 'Выберите файл' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
        return NextResponse.json(
            { error: `Файл больше 25 МБ (${(file.size / 1024 / 1024).toFixed(1)} МБ) — пришлите его ссылкой` },
            { status: 413 },
        );
    }

    const path = storagePath(orderNumber, file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());

    const upload = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
    });
    if (upload.error) {
        return NextResponse.json({ error: `Не удалось сохранить файл: ${upload.error.message}` }, { status: 502 });
    }

    const { data, error } = await supabase
        .from('order_files')
        .insert({
            order_number: orderNumber,
            file_name: file.name,
            content_type: file.type || null,
            size_bytes: file.size,
            storage_bucket: BUCKET,
            storage_path: path,
            note: String(form.get('note') ?? '').trim() || null,
            uploaded_by: session.user.email || session.user.username || null,
        })
        .select('id, file_name')
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: `Файл сохранён, но не записан в заказ: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, file: data });
}

/** Убрать свой файл из заказа: приложили не то. Файл помечаем удалённым. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const fileId = Number(new URL(request.url).searchParams.get('fileId'));
    if (!Number.isFinite(fileId)) {
        return NextResponse.json({ error: 'Не указан файл' }, { status: 400 });
    }

    const { data: row } = await supabase
        .from('order_files')
        .select('id, order_number, storage_bucket, storage_path')
        .eq('id', fileId)
        .maybeSingle();

    if (!row || String((row as any).order_number) !== decodeURIComponent(String(id))) {
        return NextResponse.json({ error: 'Файл не найден в этом заказе' }, { status: 404 });
    }

    const { error } = await supabase
        .from('order_files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', fileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Сам файл из хранилища убираем: держать мусор незачем.
    await supabase.storage.from((row as any).storage_bucket).remove([(row as any).storage_path]);

    return NextResponse.json({ ok: true });
}
