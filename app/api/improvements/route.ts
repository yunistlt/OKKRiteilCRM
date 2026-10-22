/**
 * Реестр доработок: сотрудники пишут, владелец отмечает выполненные.
 *
 * Задание владельца 15.10.2026: «нужно, чтобы девочки туда писали все
 * доработки, я буду его смотреть и после выполнения ставить отметку
 * выполнено».
 *
 * Правила доступа — его же решение: читают и пишут все, отметку «выполнено»
 * ставит только владелец.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { safeStorageSegment } from '@/lib/storage-path';
import { sendNotification } from '@/lib/notify/send';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Тот же бакет, куда ложатся файлы заказов: второго хранилища не заводим. */
const BUCKET = 'okk-assets';
/** Скриншот — картинка с экрана, а не архив проекта. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Ссылка на скриншот живёт минуту: столько же, сколько в мессенджере. */
const LINK_TTL_SECONDS = 60;

const FIELDS = 'id, text, section, order_number, screenshot_bucket, screenshot_path, screenshot_name,'
    + ' author_email, author_name, author_manager_id, created_at, done_at, done_by, done_note, done_build';

/** Имя человека для реестра: фамилия и имя, иначе логин. */
function personName(user: { first_name: string | null; last_name: string | null; username: string | null }): string | null {
    const full = [user.last_name, user.first_name].filter(Boolean).join(' ').trim();
    return full || user.username || null;
}

/** Кто ставит отметку «выполнено» (решение владельца 15.10.2026). */
function canCloseImprovements(role: string | undefined): boolean {
    return role === 'admin';
}

async function screenshotLink(row: any): Promise<string | null> {
    if (!row.screenshot_path) return null;
    const { data } = await supabase.storage
        .from(row.screenshot_bucket || BUCKET)
        .createSignedUrl(row.screenshot_path, LINK_TTL_SECONDS);
    return data?.signedUrl ?? null;
}

async function toRow(row: any) {
    return {
        id: row.id,
        text: row.text,
        section: row.section ?? null,
        orderNumber: row.order_number ?? null,
        screenshotName: row.screenshot_name ?? null,
        screenshotUrl: await screenshotLink(row),
        author: row.author_name || row.author_email || 'Неизвестно',
        createdAt: row.created_at,
        doneAt: row.done_at ?? null,
        doneBy: row.done_by ?? null,
        // Что исправлено и в какой сборке: менеджер читает это в реестре и не
        // спрашивает «а что сделали-то?» (задание владельца 15.10.2026).
        doneNote: row.done_note ?? null,
        doneBuild: row.done_build ?? null,
    };
}

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    /**
     * Карточка одной доработки. Отдельным запросом, а не из уже прочитанного
     * списка: ссылка на скриншот живёт минуту, и к моменту открытия карточки
     * та, что приехала со списком, успевает протухнуть.
     */
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (Number.isFinite(id) && id > 0) {
        const { data, error } = await supabase
            .from('improvements')
            .select(FIELDS)
            .eq('id', id)
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data) return NextResponse.json({ error: 'Доработка не найдена' }, { status: 404 });

        return NextResponse.json({
            improvement: await toRow(data),
            canClose: canCloseImprovements(session.user.role),
        });
    }

    const { data, error } = await supabase
        .from('improvements')
        .select(FIELDS)
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = await Promise.all(((data ?? []) as any[]).map(toRow));

    return NextResponse.json({
        // Открытые отдельно от выполненных: выполненные уезжают вниз
        // (решение владельца 15.10.2026).
        open: rows.filter((row) => !row.doneAt),
        done: rows.filter((row) => row.doneAt),
        canClose: canCloseImprovements(session.user.role),
    });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return NextResponse.json({ error: 'Доработка не получена' }, { status: 400 });
    }

    const text = String(form.get('text') ?? '').trim();
    if (!text) return NextResponse.json({ error: 'Напишите, что доработать' }, { status: 400 });

    let bucket: string | null = null;
    let path: string | null = null;
    let name: string | null = null;

    const file = form.get('screenshot');
    if (file instanceof File && file.size) {
        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { error: `Скриншот больше 10 МБ (${(file.size / 1024 / 1024).toFixed(1)} МБ)` },
                { status: 413 },
            );
        }

        path = `improvements/${Date.now()}-${safeStorageSegment(file.name || 'screenshot.png')}`;
        const upload = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
            contentType: file.type || 'image/png',
            upsert: true,
        });
        if (upload.error) {
            return NextResponse.json({ error: `Скриншот не сохранился: ${upload.error.message}` }, { status: 502 });
        }
        bucket = BUCKET;
        name = file.name || 'Скриншот';
    }

    const { data, error } = await supabase
        .from('improvements')
        .insert({
            text,
            section: String(form.get('section') ?? '').trim() || null,
            order_number: String(form.get('orderNumber') ?? '').trim() || null,
            screenshot_bucket: bucket,
            screenshot_path: path,
            screenshot_name: name,
            author_email: session.user.email || session.user.username || null,
            author_name: personName(session.user),
            // По номеру менеджера автору уходит ответ, когда доработку закроют.
            author_manager_id: session.user.retail_crm_manager_id ?? null,
        })
        .select(FIELDS)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, improvement: await toRow(data) });
}

/**
 * Отметка «выполнено» — и обратно, если нажали по ошибке.
 *
 * Запись не удаляется: реестр для того и нужен, чтобы было видно, что просили
 * и что из этого сделано.
 */
export async function PATCH(request: Request) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    if (!canCloseImprovements(session.user.role)) {
        return NextResponse.json({ error: 'Отметку «выполнено» ставит владелец' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const id = Number((body as any)?.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Не указана доработка' }, { status: 400 });

    const done = (body as any)?.done !== false;
    /** Пояснение к отметке и сборка, в которой правка уехала на прод. */
    const note = String((body as any)?.note ?? '').trim() || null;
    const build = String((body as any)?.build ?? '').trim() || null;

    const { data, error } = await supabase
        .from('improvements')
        .update(done
            ? {
                done_at: new Date().toISOString(),
                done_by: personName(session.user) || session.user.email || null,
                done_note: note,
                done_build: build,
            }
            : { done_at: null, done_by: null, done_note: null, done_build: null })
        .eq('id', id)
        .select(FIELDS)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Доработка не найдена' }, { status: 404 });

    if (done) await tellAuthor(data);

    return NextResponse.json({ ok: true, improvement: await toRow(data) });
}

/**
 * Ответ автору доработки: его просьба и пояснение, что сделано.
 *
 * Решение владельца 22.10.2026: «так и напиши в пояснениях и пусть бот ей
 * отправит тоже эти пояснения». Сообщение уходит в чат с Семёном (туда, где
 * человек работает), Telegram — запасным путём. Молчание тут не ошибка:
 * у автора может не быть номера менеджера, и отметку «выполнено» это ломать
 * не должно.
 */
async function tellAuthor(row: any): Promise<void> {
    try {
        let managerId = row.author_manager_id ? Number(row.author_manager_id) : null;

        // Доработки, написанные до 22.10.2026, номера менеджера не хранят —
        // добираем его по почте или логину автора.
        if (!managerId && row.author_email) {
            const { data: user } = await supabase
                .from('users')
                .select('retail_crm_manager_id')
                .or(`email.eq.${row.author_email},username.eq.${row.author_email}`)
                .maybeSingle();
            managerId = (user as any)?.retail_crm_manager_id ? Number((user as any).retail_crm_manager_id) : null;
        }

        if (!managerId) return;

        const lines = [
            `Доработка №${row.id} выполнена.`,
            '',
            `Вы писали: ${String(row.text ?? '').trim()}`,
        ];
        if (row.done_note) lines.push('', `Пояснение: ${row.done_note}`);
        if (row.done_build) lines.push('', `Сборка: ${row.done_build}`);

        await sendNotification('improvements.done', lines.join('\n'), { managerId });
    } catch (err) {
        console.error('[improvements] ответ автору не ушёл:', err);
    }
}
