/**
 * Учёт вызовов LLM по агентам: сколько раз и на сколько токенов.
 *
 * На каждый вызов модели зовём recordAiUsage(): берём токены из ответа OpenAI
 * (completion.usage / embeddingResponse.usage) и пишем строку в ai_usage_events с
 * привязкой к agent_id. Деградирует мягко: любая ошибка учёта НЕ ломает работу агента.
 *
 * Денег здесь нет и не будет. Раньше тут считалась стоимость по таблице тарифов
 * ai_model_pricing и показывалась на странице агентов в рублях. Механизм убран по
 * двум причинам.
 *
 * Первая: тарифы заводились руками и были снимком цен OpenAI, а не ценами. Снимок
 * стареет молча, и что хуже — при отсутствии тарифа стоимость писалась нулём,
 * неотличимым от бесплатного вызова. Источник правды о расходе один — счёт от
 * OpenAI, и смотреть его надо в личном кабинете, а не в нашей арифметике.
 *
 * Вторая: агрегация читалась на серверной отрисовке /agents — постранично, все
 * события за месяц пачками по 1000, со сложением в приложении. Страница ждала
 * этот проход целиком, прежде чем отдать хоть что-то.
 *
 * Запись оставлена: она дешёвая, идёт мимо ответа агента, и её зовут шестнадцать
 * файлов. Данные копятся; если счётчики понадобятся, считать их надо агрегатом на
 * стороне базы, а не перебором строк здесь.
 */
import { supabase } from '@/utils/supabase';

/** Канонические agent_id (из каталога) + служебные категории для непривязанных к персоне вызовов. */
export const AiAgent = {
    KATERINA: 'katerina',
    ANNA: 'anna',
    MAXIM: 'maxim',
    ELENA: 'elena',
    SEMEN: 'semen',
    TAMARA: 'tamara',
    DARYA: 'darya',
    TRANSCRIPTION: 'transcription', // служебная: AMD/диаризация/каналы
    EMBEDDINGS: 'embeddings',       // служебная: RAG/семантический поиск
} as const;

interface OpenAiUsageLike {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
}

export async function recordAiUsage(opts: {
    agentId: string;
    model?: string | null;
    usage?: OpenAiUsageLike | null;
    purpose?: string;
}): Promise<void> {
    try {
        const usage = opts.usage || {};
        const promptTokens = Number(usage.prompt_tokens) || 0;
        const completionTokens = Number(usage.completion_tokens) || 0;
        const cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens) || 0;

        await supabase.from('ai_usage_events').insert({
            agent_id: opts.agentId,
            model: opts.model || 'unknown',
            purpose: opts.purpose || null,
            prompt_tokens: promptTokens,
            cached_tokens: cachedTokens,
            completion_tokens: completionTokens,
            // cost_usd не передаём: колонка объявлена NOT NULL DEFAULT 0 и остаётся
            // в схеме ради уже накопленных строк. Ноль в ней теперь означает не
            // «бесплатно», а «стоимость не считаем».
        });
    } catch (e: any) {
        // Учёт не должен влиять на работу агента.
        console.warn('[ai-usage] record failed:', e?.message || e);
    }
}
