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
import { safeStorageSegment } from '@/lib/storage-path';

const MAX_BYTES = 25 * 1024 * 1024;

function storagePath(orderNumber: string, fileName: string): string {
    // И номер, и имя — латиницей: у своих заказов номер с кириллической «А»
    // («1038А»), и хранилище отказывалось принимать такой ключ.
    return `order-files/${safeStorageSegment(orderNumber, 40)}/manual/${Date.now()}-${safeStorageSegment(fileName)}`;
}

/**
 * Файл крупнее ~4,5 МБ через наш сервер не проходит: столько весит
 * максимальное тело запроса на Vercel. Интерфейс при этом обещал 25 МБ, а
 * менеджер видел, что вложение «не отправляется» (жалоба Евгении Матвеевой
 * 19.10.2026). За всё время в заказы не загрузился НИ ОДИН файл тяжелее
 * 4,11 МБ — ровно у этой границы.
 *
 * Поэтому крупные файлы браузер кладёт в хранилище напрямую по подписанной
 * ссылке, минуя наш сервер — так же, как это сделано в мессенджере и в
 * документах юротдела. Здесь два шага:
 *
 *   1. `{ fileName, size, contentType }` → подписанная ссылка и путь;
 *   2. `{ register: { path, fileName, size, contentType } }` → запись в
 *      `order_files`, когда файл уже лежит в хранилище.
 *
 * Другого пути загрузки нет: форма `multipart/form-data` убрана, чтобы файл
 * не поехал через сервер снова.
 */
async function signUpload(orderNumber: string, body: any) {
    const fileName = String(body?.fileName ?? '').trim();
    const size = Number(body?.size ?? 0);

    if (!fileName) return NextResponse.json({ error: 'Выберите файл' }, { status: 400 });
    if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'Выберите файл' }, { status: 400 });
    if (size > MAX_BYTES) {
        return NextResponse.json(
            { error: `Файл больше 25 МБ (${(size / 1024 / 1024).toFixed(1)} МБ) — пришлите его ссылкой` },
            { status: 413 },
        );
    }

    const path = storagePath(orderNumber, fileName);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
        return NextResponse.json({ error: `Не удалось начать загрузку: ${error?.message ?? 'хранилище молчит'}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, bucket: BUCKET, path, token: data.token });
}

/** Файл уже в хранилище — записываем его в заказ. */
async function registerUploaded(orderNumber: string, body: any, actor: string | null) {
    const path = String(body?.path ?? '').trim();
    const fileName = String(body?.fileName ?? '').trim();

    if (!path || !fileName) return NextResponse.json({ error: 'Файл не получен' }, { status: 400 });
    // Путь выдаём мы сами — чужой сюда приехать не должен.
    if (!path.startsWith(`order-files/${safeStorageSegment(orderNumber, 40)}/manual/`)) {
        return NextResponse.json({ error: 'Файл не из этого заказа' }, { status: 400 });
    }

    /**
     * Тот же файл в том же заказе — это не второе вложение, а повтор:
     * двойной щелчок, повтор по таймауту сети, два пути отправки разом или
     * файл, который уже лежит в заказе с прошлого раза. Отдаём уже записанный
     * (фикс 89d3a730 от 14.10.2026 — письмо клало вложение дважды).
     *
     * Срок давности здесь был 60 секунд, и давний файл упирался в уникальный
     * индекс `order_files_no_dupes_idx`: Ирина Гордеева видела «Файл сохранён,
     * но не записан в заказ: duplicate key…» и письмо в бухгалтерию не уходило
     * (доработка №29, 21.10.2026). Условие теперь ровно то же, что у индекса.
     */
    const size = Number(body?.size ?? 0) || null;
    const findExisting = async () => {
        const { data } = await supabase
            .from('order_files')
            .select('id, file_name')
            .eq('order_number', orderNumber)
            .eq('file_name', fileName)
            .eq('size_bytes', size)
            .is('deleted_at', null)
            .is('archived_at', null)
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data;
    };

    const existing = await findExisting();
    if (existing) {
        return NextResponse.json({ ok: true, file: existing, already: true });
    }

    const { data, error } = await supabase
        .from('order_files')
        .insert({
            order_number: orderNumber,
            file_name: fileName,
            content_type: String(body?.contentType ?? '') || null,
            size_bytes: size,
            storage_bucket: BUCKET,
            storage_path: path,
            note: String(body?.note ?? '').trim() || null,
            uploaded_by: actor,
        })
        .select('id, file_name')
        .maybeSingle();

    if (error) {
        // Два одновременных прохода: индекс не пустил второй — значит файл уже в заказе.
        const raced = await findExisting();
        if (raced) return NextResponse.json({ ok: true, file: raced, already: true });
        return NextResponse.json({ error: `Файл сохранён, но не записан в заказ: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, file: data });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const orderNumber = decodeURIComponent(String(id));
    const actor = session.user.email || session.user.username || null;

    // Прямая загрузка в хранилище: два шага, оба — лёгкий JSON.
    if ((request.headers.get('content-type') || '').includes('application/json')) {
        const body = await request.json().catch(() => null);
        if (!body) return NextResponse.json({ error: 'Файл не получен' }, { status: 400 });
        return body.register
            ? registerUploaded(orderNumber, body.register, actor)
            : signUpload(orderNumber, body);
    }

    /**
     * Файл формой — обычный путь, для всего, что проходит по размеру.
     *
     * Прямая загрузка в хранилище осталась для крупных файлов: браузер идёт
     * туда на чужой домен, и у менеджеров его режет сетевая фильтрация
     * (жалоба Евгении Матвеевой 20.10.2026).
     */
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
    const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
    });
    if (upload.error) {
        return NextResponse.json({ error: `Не удалось сохранить файл: ${upload.error.message}` }, { status: 502 });
    }

    return registerUploaded(orderNumber, {
        path,
        fileName: file.name,
        size: file.size,
        contentType: file.type || null,
        note: String(form.get('note') ?? '').trim() || null,
    }, actor);
}

/** Убрать файл из списка заказа: приложили не то. Файл уходит в архив. */
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

    /**
     * Файл не удаляем — помечаем архивным (ЗАКОН владельца 12.10.2026:
     * «никакие файлы нельзя удалять, можно только пометить как архивные»).
     *
     * Раньше здесь же стирался сам файл из хранилища, и вернуть его было
     * нельзя. Теперь он остаётся на месте и открывается из архива.
     */
    const { error } = await supabase
        .from('order_files')
        .update({
            archived_at: new Date().toISOString(),
            archived_by: session.user.email || session.user.username || null,
        })
        .eq('id', fileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, archived: true });
}

/**
 * Вернуть файл из архива в заказ.
 *
 * Обратная дверь к архивации: раз удалять нельзя, человек должен уметь и
 * передумать, не прося об этом разработчика.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { id } = await params;
    const fileId = Number(new URL(request.url).searchParams.get('fileId'));
    if (!Number.isFinite(fileId)) {
        return NextResponse.json({ error: 'Не указан файл' }, { status: 400 });
    }

    const { data: row } = await supabase
        .from('order_files')
        .select('id, order_number, deleted_at')
        .eq('id', fileId)
        .maybeSingle();

    if (!row || String((row as any).order_number) !== decodeURIComponent(String(id))) {
        return NextResponse.json({ error: 'Файл не найден в этом заказе' }, { status: 404 });
    }

    // Файлы, стёртые до закона 12.10.2026, вернуть невозможно: в хранилище их нет.
    if ((row as any).deleted_at) {
        return NextResponse.json({ error: 'Этот файл был стёрт до правила — возвращать нечего' }, { status: 409 });
    }

    const { error } = await supabase
        .from('order_files')
        .update({ archived_at: null, archived_by: null })
        .eq('id', fileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, restored: true });
}
