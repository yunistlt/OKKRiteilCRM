/**
 * Отметка «выполнено» в реестре доработок — один код для кнопки и скрипта.
 *
 * Кнопку нажимает владелец в интерфейсе, скриптом закрывают пачку за раз
 * после выкатки. Если бы это были два куска кода, пачка молча уезжала бы без
 * сообщения автору: по решению владельца 22.10.2026 пояснение к отметке
 * обязано дойти до человека, который доработку написал.
 */
import { supabase } from '@/utils/supabase';
import { sendNotification } from '@/lib/notify/send';

/** Набор полей записи реестра: читают и карточка, и список, и скрипт. */
export const IMPROVEMENT_FIELDS =
    'id, text, section, order_number, screenshot_bucket, screenshot_path, screenshot_name,'
    + ' author_email, author_name, author_manager_id, created_at, done_at, done_by, done_note, done_build,'
    + ' clarify_note, clarify_at, clarify_by, pinned_at, pinned_by, edited_at, edited_by';

export interface CloseInput {
    /** Что исправлено — уходит автору дословно. */
    note?: string | null;
    /** Сборка, в которой правка уехала на прод. */
    build?: string | null;
    /** Кто поставил отметку. */
    by?: string | null;
}

/**
 * Ставит отметку и пишет автору. Возвращает запись или null, если её нет.
 */
export async function closeImprovement(id: number, input: CloseInput): Promise<any | null> {
    const { data, error } = await supabase
        .from('improvements')
        .update({
            done_at: new Date().toISOString(),
            done_by: input.by ?? null,
            done_note: input.note?.trim() || null,
            done_build: input.build?.trim() || null,
        })
        .eq('id', id)
        .select(IMPROVEMENT_FIELDS)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    await tellAuthor(data);
    return data;
}

/** Снятие отметки: нажали по ошибке. Автору об этом не пишем. */
export async function reopenImprovement(id: number): Promise<any | null> {
    const { data, error } = await supabase
        .from('improvements')
        .update({ done_at: null, done_by: null, done_note: null, done_build: null })
        .eq('id', id)
        .select(IMPROVEMENT_FIELDS)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return data ?? null;
}

export async function tellAuthor(row: any): Promise<void> {
    const lines = [
        `Доработка №${row.id} выполнена.`,
        '',
        `Вы писали: ${String(row.text ?? '').trim()}`,
    ];
    if (row.done_note) lines.push('', `Пояснение: ${row.done_note}`);
    if (row.done_build) lines.push('', `Сборка: ${row.done_build}`);
    await notifyAuthor(row, lines.join('\n'), 'improvements.done');
}

/**
 * Сообщение автору доработки — в чат с Семёном (туда, где человек работает),
 * Telegram запасным путём. Молчание здесь не ошибка: у автора может не быть
 * номера менеджера, и отметку в реестре это ломать не должно.
 */
export async function notifyAuthor(row: any, text: string, code: string): Promise<void> {
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
        await sendNotification(code, text, { managerId });
    } catch (err) {
        console.error('[improvements] сообщение автору не ушло:', err);
    }
}
