/**
 * Учёт расходов на LLM по агентам («зарплата ИИ»).
 *
 * На каждый вызов модели зовём recordAiUsage(): берём токены из ответа OpenAI
 * (completion.usage / embeddingResponse.usage), считаем стоимость в USD по тарифам
 * из ai_model_pricing (снимок на момент вызова) и пишем строку в ai_usage_events с
 * привязкой к agent_id. Деградирует мягко: любая ошибка учёта НЕ ломает работу агента.
 *
 * Тарифы и курс ₽ — в БД (без хардкода). Стоимость в USD фиксируем при записи (снимок),
 * в рубли переводим при ОТОБРАЖЕНИИ по текущему курсу (ai_cost_settings.usd_to_rub).
 */
import { supabase } from '@/utils/supabase';

/** Канонические agent_id (из каталога) + служебные категории для непривязанных к персоне вызовов. */
export const AiAgent = {
    KATERINA: 'katerina',
    ANNA: 'anna',
    MAXIM: 'maxim',
    ELENA: 'elena',
    SEMEN: 'semen',
    DARYA: 'darya',
    TRANSCRIPTION: 'transcription', // служебная: AMD/диаризация/каналы
    EMBEDDINGS: 'embeddings',       // служебная: RAG/семантический поиск
} as const;

type Pricing = { input: number; cached: number; output: number };
let pricingCache: { at: number; map: Record<string, Pricing> } | null = null;
const PRICING_TTL_MS = 5 * 60 * 1000;

async function getPricing(): Promise<Record<string, Pricing>> {
    if (pricingCache && Date.now() - pricingCache.at < PRICING_TTL_MS) return pricingCache.map;
    const map: Record<string, Pricing> = {};
    try {
        const { data } = await supabase
            .from('ai_model_pricing')
            .select('model, input_per_1m, cached_input_per_1m, output_per_1m');
        for (const r of data || []) {
            map[r.model] = {
                input: Number(r.input_per_1m) || 0,
                cached: Number(r.cached_input_per_1m) || 0,
                output: Number(r.output_per_1m) || 0,
            };
        }
    } catch { /* graceful */ }
    pricingCache = { at: Date.now(), map };
    return map;
}

interface OpenAiUsageLike {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
}

/**
 * Фиксирует один вызов LLM в журнал расходов. Вызывать ПОСЛЕ получения ответа.
 * @param agentId  кому отнести расход (AiAgent.*)
 * @param model    модель; лучше передавать completion.model (фактическая модель ответа)
 * @param usage    completion.usage (или embeddingResponse.usage)
 * @param purpose  короткий код назначения вызова (для разбивки), напр. 'email_classify'
 */
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
        const model = opts.model || 'unknown';

        const pricing = await getPricing();
        const p = pricing[model];
        let costUsd = 0;
        if (p) {
            const freshInput = Math.max(0, promptTokens - cachedTokens);
            costUsd =
                (freshInput / 1e6) * p.input +
                (cachedTokens / 1e6) * p.cached +
                (completionTokens / 1e6) * p.output;
        }

        await supabase.from('ai_usage_events').insert({
            agent_id: opts.agentId,
            model,
            purpose: opts.purpose || null,
            prompt_tokens: promptTokens,
            cached_tokens: cachedTokens,
            completion_tokens: completionTokens,
            cost_usd: Number(costUsd.toFixed(6)),
        });
    } catch (e: any) {
        // Учёт не должен влиять на работу агента.
        console.warn('[ai-usage] record failed:', e?.message || e);
    }
}

/** Курс USD→RUB из настройки (по умолчанию 90). */
export async function getUsdToRub(): Promise<number> {
    try {
        const { data } = await supabase.from('ai_cost_settings').select('usd_to_rub').maybeSingle();
        const n = Number(data?.usd_to_rub);
        return Number.isFinite(n) && n > 0 ? n : 90;
    } catch {
        return 90;
    }
}

export interface AgentCost {
    costUsd: number;
    calls: number;
    promptTokens: number;
    completionTokens: number;
}

/**
 * Суммарные расходы по агентам за период [since, now). Возвращает { agentId: AgentCost }.
 * since по умолчанию — начало текущего месяца (UTC).
 */
export async function getAgentCosts(since?: Date): Promise<Record<string, AgentCost>> {
    const from = since || new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z');
    const out: Record<string, AgentCost> = {};
    try {
        // Тянем агрегируемые строки постранично (на больших объёмах — по 1000).
        let fromIdx = 0;
        const PAGE = 1000;
        for (;;) {
            const { data } = await supabase
                .from('ai_usage_events')
                .select('agent_id, cost_usd, prompt_tokens, completion_tokens')
                .gte('created_at', from.toISOString())
                .range(fromIdx, fromIdx + PAGE - 1);
            const rows = data || [];
            for (const r of rows) {
                const a = (out[r.agent_id] ||= { costUsd: 0, calls: 0, promptTokens: 0, completionTokens: 0 });
                a.costUsd += Number(r.cost_usd) || 0;
                a.calls += 1;
                a.promptTokens += Number(r.prompt_tokens) || 0;
                a.completionTokens += Number(r.completion_tokens) || 0;
            }
            if (rows.length < PAGE) break;
            fromIdx += PAGE;
        }
    } catch (e: any) {
        console.warn('[ai-usage] getAgentCosts failed:', e?.message || e);
    }
    return out;
}
