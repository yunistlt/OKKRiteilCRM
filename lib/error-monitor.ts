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

export function logError(source: string, err: unknown, context?: ErrorContext): void {
    const e = err instanceof Error ? err : new Error(String(err));
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
