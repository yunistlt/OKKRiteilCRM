import { supabase } from '@/utils/supabase';
import { randomUUID } from 'crypto';

/**
 * Запись разговора с агентом: вопрос, ответ и чем он при этом пользовался.
 *
 * Пишем в `okk_consultant_logs` — то же место, что читает экран «Аудит Семёна».
 * Заводить вторую таблицу под ту же задачу было бы лишним.
 *
 * ЗАПИСЬ НИКОГДА НЕ РОНЯЕТ РАЗГОВОР. Если лог не сохранился, человек всё равно должен
 * получить ответ: наблюдение — наша задача, а не его проблема. Поэтому ошибки здесь
 * только пишутся в консоль.
 */
export interface DialogLogInput {
    channel: 'web' | 'telegram';
    question: string;
    answer: string;
    model?: string | null;
    /** Имена вызванных инструментов по порядку — по ним видно, чем агент добывал ответ. */
    tools?: string[];
    userId?: string | null;
    username?: string | null;
    managerId?: number | null;
    orderId?: number | null;
    threadId?: string | null;
    intent?: string | null;
    usedFallback?: boolean;
    promptTokens?: number | null;
    completionTokens?: number | null;
    latencyMs?: number | null;
}

export async function logAssistantDialog(input: DialogLogInput): Promise<string | null> {
    const traceId = randomUUID();

    try {
        const { error } = await supabase.from('okk_consultant_logs').insert({
            trace_id: traceId,
            channel: input.channel,
            thread_id: input.threadId ?? null,
            user_id: input.userId ?? null,
            username: input.username ?? null,
            manager_id: input.managerId ?? null,
            order_id: input.orderId ?? null,
            intent: input.intent ?? null,
            question: input.question,
            answer: input.answer,
            // Старые строки живут с обрезанным ответом — колонку заполняем и дальше,
            // чтобы экран аудита одинаково показывал и прежние записи, и новые.
            answer_preview: input.answer.slice(0, 500),
            model: input.model ?? null,
            tools: summarizeTools(input.tools),
            used_fallback: input.usedFallback ?? false,
            prompt_tokens: input.promptTokens ?? null,
            completion_tokens: input.completionTokens ?? null,
            latency_ms: input.latencyMs ?? null,
        });

        if (error) {
            console.warn('[dialog-log] Разговор не записался:', error.message);
            return null;
        }
    } catch (e) {
        console.warn('[dialog-log] Разговор не записался:', e instanceof Error ? e.message : e);
        return null;
    }

    return traceId;
}

/** Инструменты складываем в «сколько раз каждый» — так видно и состав, и зацикливание. */
function summarizeTools(tools?: string[]): Record<string, number> | null {
    if (!tools?.length) return null;

    const counts: Record<string, number> = {};
    for (const name of tools) {
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
}
