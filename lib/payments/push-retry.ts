/**
 * Повторная проводка платежа: считаем попытки и решаем, звать ли человека.
 *
 * Платёж, привязанный к заказу, но не проведённый, крон пробует снова каждые
 * несколько минут — деньги не теряются. Но сообщать об этом человеку каждый раз
 * бессмысленно: 30.09.2026 при поломке магазина в RetailCRM в чат ушёл поток
 * одинаковых «Оплата не проведена».
 *
 * Правило: сообщаем при первой ошибке, потом — только если текст ошибки
 * изменился или прошло больше шести часов.
 */
import { supabase } from '@/utils/supabase';

const REPEAT_AFTER_MS = 6 * 60 * 60 * 1000;

/** Сбой, который чинится не у нас: ждать ремонта RetailCRM, руками делать нечего. */
export function isCrmOutage(error: string): boolean {
    const text = String(error).toLowerCase();
    return text.includes("parameter 'site'") || text.includes('parameter "site"');
}

/** Объяснение для человека — чтобы он понимал, ждать или чинить. */
export function explainPushError(error: string, attempts: number): string {
    if (isCrmOutage(error)) {
        return 'RetailCRM не принимает магазин этого заказа — сбой на их стороне. '
            + `Платёж сохранён и проводится автоматически, попыток уже ${attempts}. `
            + 'Как только магазин заработает, оплата пройдёт сама — делать ничего не нужно.';
    }
    return 'Платёж сохранён и будет повторён автоматически. Если ошибка повторяется — нужен разбор.';
}

export type PushFailure = {
    attempts: number;
    /** Звать ли человека сейчас. */
    shouldNotify: boolean;
    explanation: string;
};

/** Записать неудачную попытку и решить, сообщать ли о ней. */
export async function registerPushFailure(paymentId: string | number, error: string): Promise<PushFailure> {
    const { data: row } = await supabase
        .from('point_payments')
        .select('push_attempts, push_error_notified_at, push_error_last')
        .eq('id', paymentId)
        .maybeSingle();

    const attempts = Number((row as any)?.push_attempts ?? 0) + 1;
    const lastError = (row as any)?.push_error_last ?? null;
    const notifiedAt = (row as any)?.push_error_notified_at
        ? new Date(String((row as any).push_error_notified_at)).getTime()
        : 0;

    const errorChanged = lastError !== error;
    const longEnough = Date.now() - notifiedAt > REPEAT_AFTER_MS;
    const shouldNotify = errorChanged || longEnough;

    await supabase
        .from('point_payments')
        .update({
            push_attempts: attempts,
            push_error_last: error,
            ...(shouldNotify ? { push_error_notified_at: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);

    return { attempts, shouldNotify, explanation: explainPushError(error, attempts) };
}

/** Проводка удалась — забываем накопленные жалобы. */
export async function clearPushFailure(paymentId: string | number): Promise<void> {
    await supabase
        .from('point_payments')
        .update({ push_error_last: null, push_error_notified_at: null, updated_at: new Date().toISOString() })
        .eq('id', paymentId);
}
