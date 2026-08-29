import { getCrmConfig, updateExistingOrderInCrm } from '@/lib/retailcrm/leads';

// Рекомендации РОПа в карточке заказа.
//
// Пишем в «Комментарий менеджера» — то самое поле, куда менеджер кладёт
// договорённости с клиентом: «Все из 0,8 мм, оплата в понедельник». Поэтому
// главное правило здесь одно: НИКОГДА не перезаписывать. orders/edit заменяет
// поле целиком, и одна невнимательная запись сотрёт то, о чём договаривались
// полгода. Сначала читаем, потом дописываем.
//
// Каждая строка начинается датой и подписью: через месяц в комментарии будет
// десяток заметок, и без даты непонятно, какая из них про сегодня. Подпись
// нужна, чтобы менеджер отличал совет робота от слов коллеги.

export const ROP_PREFIX = 'РОП';

/** «29.08.2026 РОП: текст» — дата первой, чтобы порядок читался с одного взгляда. */
export function formatRopNote(text: string, date = new Date()): string {
    const d = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${d} ${ROP_PREFIX}: ${text.trim()}`;
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

async function currentComment(orderId: number): Promise<{ comment: string; site: string } | null> {
    const { url, key } = await getCrmConfig();
    const res = await fetch(`${url}/api/v5/orders/${orderId}?by=id`, { headers: { 'X-API-KEY': key } });
    const data = await res.json();
    if (!data.success || !data.order) return null;
    return { comment: String(data.order.managerComment ?? ''), site: data.order.site };
}

export type NoteResult = { ok: boolean; skipped?: 'already' | 'no-order'; error?: string };

/**
 * Дописывает рекомендацию в карточку заказа.
 *
 * Возвращает результат, а не бросает: одна недоступная карточка не должна
 * ронять утреннюю рассылку — план в Telegram полезен и без записи в CRM.
 */
export async function appendRopNote(orderId: number, text: string, date = new Date()): Promise<NoteResult> {
    try {
        const current = await currentComment(orderId);
        if (!current) return { ok: false, skipped: 'no-order' };
        if (alreadyNotedToday(current.comment, date)) return { ok: false, skipped: 'already' };

        const merged = mergeComment(current.comment, formatRopNote(text, date));
        const res = await updateExistingOrderInCrm(orderId, { noteText: merged }, current.site);
        return res.success ? { ok: true } : { ok: false, error: res.errorMsg };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
}
