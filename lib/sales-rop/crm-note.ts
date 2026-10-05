import { supabase } from '@/utils/supabase';

// Рекомендации РОПа по заказу.
//
// Раньше они дописывались в «Комментарий менеджера» — туда же, где менеджер
// держит договорённости с клиентом. Лента росла: по заказу 53603 к 05.10.2026
// она доросла до 7 000 знаков, и советы робота перемешались со словами людей.
// Решение владельца 05.10.2026: заметки бота живут отдельным окном рядом с
// комментарием менеджера.
//
// Отдельной таблицы под них не завели: текст заметки — это `reason_text`
// задачи дня (`sales_rop_task`), он там и лежит вместе с датой плана и
// моментом записи. Здесь остаётся только решение «нужна ли сегодня новая
// заметка» — чтобы один и тот же совет не повторялся, пока по заказу ничего
// не делали.

export const ROP_PREFIX = 'РОП';

/** «29.08.2026 РОП: текст» — дата первой, чтобы порядок читался с одного взгляда. */
export function formatRopNote(text: string, date = new Date()): string {
    const d = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    // Заметка всегда в одну строку. Многострочная не отличима от текста
    // менеджера: её вторая строка остаётся в карточке навсегда, потому что
    // разбор ищет дату в начале строки. На этом уже обожглись.
    const oneLine = text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return `${d} ${ROP_PREFIX}: ${oneLine}`;
}

/** Уже писали такое сегодня? Повтор одного и того же совета обесценивает все. */
export function alreadyNotedToday(comment: string, date = new Date()): boolean {
    const d = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return comment.split('\n').some((line) => line.trim().startsWith(`${d} ${ROP_PREFIX}:`));
}

/**
 * Сколько заметок РОПа хранить в комментарии.
 *
 * Комментарий не резиновый, а старые советы теряют смысл: «позвонить, счёт висит
 * три дня» месячной давности только мешает читать. Записи менеджера при этом не
 * трогаем никогда — обрезаются только строки РОПа.
 */
const MAX_ROP_LINES = 5;

export function mergeComment(existing: string, note: string): string {
    const lines = (existing || '').split('\n');
    const mine: string[] = [];
    const theirs: string[] = [];

    for (const line of lines) {
        if (/^\d{2}\.\d{2}\.\d{4}\s+РОП:/.test(line.trim())) mine.push(line);
        else theirs.push(line);
    }

    // Свежая заметка сверху: её читают первой, а вниз уходит история.
    const ropLines = [note, ...mine].slice(0, MAX_ROP_LINES);
    const human = theirs.join('\n').trim();

    return human ? `${ropLines.join('\n')}\n\n${human}` : ropLines.join('\n');
}

export type NoteResult = {
    ok: boolean;
    skipped?: 'already' | 'no-order' | 'not-worked';
    error?: string;
};

/**
 * Нужна ли новая заметка.
 *
 * Предыдущая висит нетронутой — значит по заказу ничего не произошло, и сказать
 * нам нечего: ситуация та же, совет тот же. Второй такой же совет не добавляет
 * смысла, он добавляет строку, из-за которой перестают читать все остальные.
 *
 * Работой считается действие человека после нашей записи: комментарий, смена
 * статуса, звонок, письмо. Свои правки (дата контакта) не считаем — иначе бот
 * принял бы за работу то, что сделал сам.
 */
export function noteNeeded(lastNoteAt: string | null, lastTouchAt: string | null): boolean {
    if (!lastNoteAt) return true;
    if (!lastTouchAt) return false;
    return new Date(lastTouchAt).getTime() > new Date(lastNoteAt).getTime();
}

/**
 * Нужна ли сегодня заметка по заказу. Текст писать никуда не надо — он уже
 * лежит в задаче дня, карточка показывает его отдельным окном.
 *
 * Возвращает результат, а не бросает: одна проблема не должна ронять утреннюю
 * рассылку — план в Telegram полезен сам по себе.
 */
export async function appendRopNote(orderId: number, _text: string, _date = new Date()): Promise<NoteResult> {
    try {
        const { data } = await supabase.rpc('sales_rop_note_state', { p_order_id: orderId });
        const state = ((data ?? []) as any[])[0];
        if (state && !noteNeeded(state.last_note_at ?? null, state.last_touch_at ?? null)) {
            return { ok: false, skipped: 'not-worked' };
        }
        // Сам текст уже сохранён задачей дня — здесь только разрешаем заметку.
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}
