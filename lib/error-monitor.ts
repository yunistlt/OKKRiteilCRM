/**
 * Централизованный мониторинг ошибок — пишет в Supabase таблицу error_logs.
 *
 * Использование:
 *   import { logError, logWarn } from '@/lib/error-monitor';
 *   logError('widget/chat', err, { visitorId, ip });
 *
 * Правила:
 * - Никогда не бросает исключений (graceful — мониторинг не должен ломать prod)
 * - Обрезает контекст до 4KB чтобы не раздувать JSONB
 * - Fire-and-forget (не await)
 */

import { supabase } from '@/utils/supabase';

interface ErrorContext {
    [key: string]: unknown;
}

function truncate(obj: ErrorContext): ErrorContext {
    try {
        const str = JSON.stringify(obj);
        if (str.length <= 4096) return obj;
        // Сериализуем укороченную версию
        return { _truncated: true, preview: str.slice(0, 512) };
    } catch {
        return { _error: 'unserializable context' };
    }
}

async function writeLog(
    source: string,
    level: 'error' | 'warn' | 'info',
    message: string,
    stack?: string,
    context?: ErrorContext,
) {
    try {
        await supabase.from('error_logs').insert({
            source,
            level,
            message: message.slice(0, 2000),
            stack: stack ? stack.slice(0, 4000) : null,
            context: context ? truncate(context) : null,
        });
    } catch {
        // Совсем тихо — нельзя ронять прод из-за мониторинга
    }
}

/**
 * Человеческий текст из чего угодно, что прилетело в catch.
 *
 * Ошибка Supabase — не Error, а обычный объект { message, code, details, hint }.
 * `String(err)` превращал его в «[object Object]», и в журнале оставалась
 * пустышка: 07.10.2026 закрытие периода падало, запись в журнале была, а
 * причины в ней не было. Собираем всё, что объект о себе рассказывает.
 */
export function describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
        const o = err as Record<string, unknown>;
        const parts = [o.message, o.details, o.hint]
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => String(v).trim());
        if (o.code) parts.push(`код ${o.code}`);
        if (parts.length) return parts.join(' · ');
        try {
            return JSON.stringify(err).slice(0, 500);
        } catch {
            return '[нечитаемая ошибка]';
        }
    }
    return String(err);
}

export function logError(source: string, err: unknown, context?: ErrorContext): void {
    const e = err instanceof Error ? err : new Error(describeError(err));
    // Параллельно: в консоль (Vercel logs) + в Supabase
    console.error(`[${source}]`, e.message, context || '');
    void writeLog(source, 'error', e.message, e.stack, context);
}

export function logWarn(source: string, message: string, context?: ErrorContext): void {
    console.warn(`[${source}] WARN:`, message, context || '');
    void writeLog(source, 'warn', message, undefined, context);
}

export function logInfo(source: string, message: string, context?: ErrorContext): void {
    // info только в Supabase, не спамит консоль
    void writeLog(source, 'info', message, undefined, context);
}
