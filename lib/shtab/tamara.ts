import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { generateEmbedding } from '@/lib/embeddings';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { SHTAB_TOOLS, SHTAB_TOOL_NAMES, executeShtabTool } from '@/lib/shtab/tamara-tools';

// Разговорный слой Тамары.
//
// Устроен как у Семёна (app/api/okk/consultant/route.ts): ограниченный цикл
// вызова инструментов, промпт из ai_prompts, знания из базы знаний, расход
// пишется в общий учёт. Отличие одно и принципиальное — набор инструментов и
// правило, что вне их Тамара о компании не знает ничего.

/** Больше витков — больше шанс, что модель уйдёт кругами вместо ответа. */
const MAX_TOOL_ITERATIONS = 5;

/** Ниже этой близости выдержка из знаний скорее мешает, чем помогает. */
const KNOWLEDGE_THRESHOLD = 0.35;
const KNOWLEDGE_LIMIT = 4;

/** Сколько последних реплик отдаём модели как контекст разговора. */
const HISTORY_DEPTH = 8;

export type TamaraPrompt = {
    key: string;
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
};

/**
 * Промпт из ai_prompts. Если строки нет (миграция не применена) — бросаем, а не
 * подставляем зашитый текст: молчаливый фолбэк на другой промпт означал бы, что
 * правки в админке не действуют, и никто бы этого не заметил.
 */
export async function getTamaraPrompt(key: string): Promise<TamaraPrompt> {
    const { data, error } = await supabase
        .from('ai_prompts')
        .select('key, system_prompt, user_prompt_template, model, temperature, max_tokens, is_active')
        .eq('key', key)
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw new Error(`Не удалось прочитать промпт ${key}: ${error.message}`);
    if (!data) throw new Error(`Промпт ${key} не найден в ai_prompts — применена ли миграция Тамары?`);

    return {
        key: data.key,
        systemPrompt: data.system_prompt,
        userPromptTemplate: data.user_prompt_template || '{{question}}',
        model: data.model || 'gpt-4o-mini',
        temperature: Number(data.temperature ?? 0.3),
        maxTokens: Number(data.max_tokens ?? 900),
    };
}

export type KnowledgeHit = { slug: string; title: string; content: string; source_ref: string; similarity: number };

/** Поиск по знаниям Тамары. Пустой результат — не ошибка: знания могут быть не засеяны. */
export async function searchTamaraKnowledge(query: string): Promise<KnowledgeHit[]> {
    if (!isOpenAIConfigured() || !query.trim()) return [];
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_shtab_kb', {
            query_embedding: embedding,
            match_threshold: KNOWLEDGE_THRESHOLD,
            match_count: KNOWLEDGE_LIMIT,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as KnowledgeHit[];
    } catch {
        // Знания — приправа, а не основа ответа: без них Тамара всё равно
        // отвечает по инструментам, поэтому сбой поиска не должен ронять разговор.
        return [];
    }
}

export function formatKnowledge(hits: KnowledgeHit[]): string {
    if (hits.length === 0) return 'Подходящих выдержек не нашлось.';
    return hits
        .map((h) => `— ${h.title}${h.source_ref ? ` (источник: ${h.source_ref})` : ''}\n${h.content}`)
        .join('\n\n');
}

export function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

export type TamaraAnswer = {
    reply: string;
    usedTools: Array<{ name: string; args: unknown }>;
    model: string | null;
};

/**
 * Один заход к модели с инструментами.
 *
 * Правило «не выдумывать числа» продублировано здесь, а не только в промпте из
 * базы: промпт правится в админке, и одной опечатки хватило бы, чтобы снять
 * ограничение молча.
 */
export async function runTamara(opts: {
    prompt: TamaraPrompt;
    userContent: string;
    purpose: string;
    withTools?: boolean;
    /**
     * Схема ответа для структурированного вывода. Нужна там, где ответ разбирает
     * не человек, а код: программа состоит из задач пяти типов, и форму надо
     * гарантировать схемой, а не уговорами в промпте.
     */
    schema?: { name: string; schema: Record<string, unknown> };
}): Promise<TamaraAnswer> {
    if (!isOpenAIConfigured()) {
        return { reply: 'Модель не настроена: нет OPENAI_API_KEY.', usedTools: [], model: null };
    }
    const openai = getOpenAIClient();
    const usedTools: Array<{ name: string; args: unknown }> = [];
    let lastModel: string | null = null;

    const GUARDRAIL =
        'Отвечай только тем, что вернули инструменты. Любое число или факт о компании, которого нет в их ответах, называть запрещено — вместо этого скажи, каких данных не хватает. ' +
        'Простои оборудования по отказам, нарушения дисциплины и вопросы рабочих в ЦехУспехе не хранятся — обещать их оттуда нельзя ни при каких условиях, это ручной замер.';

    const messages: any[] = [
        { role: 'system', content: `${opts.prompt.systemPrompt}\n\n${GUARDRAIL}` },
        { role: 'user', content: opts.userContent },
    ];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const completion = await openai.chat.completions.create({
            model: opts.prompt.model,
            temperature: opts.prompt.temperature,
            max_tokens: opts.prompt.maxTokens,
            messages,
            ...(opts.withTools === false ? {} : { tools: SHTAB_TOOLS as any }),
            ...(opts.schema
                ? {
                      response_format: {
                          type: 'json_schema',
                          json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema },
                      },
                  }
                : {}),
        } as any);
        lastModel = completion.model;
        await recordAiUsage({
            agentId: AiAgent.TAMARA,
            model: completion.model,
            usage: completion.usage,
            purpose: opts.purpose,
        });

        const choice = completion.choices[0]?.message;
        if (!choice) break;

        if (choice.tool_calls?.length) {
            messages.push(choice);
            for (const call of choice.tool_calls) {
                const name = (call as any).function?.name as string;
                let args: any = {};
                try {
                    args = JSON.parse((call as any).function?.arguments || '{}');
                } catch {
                    args = {};
                }
                const result = SHTAB_TOOL_NAMES.has(name)
                    ? await executeShtabTool(name, args)
                    : { available: false, reason: `Неизвестный инструмент: ${name}` };
                usedTools.push({ name, args });
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify(result),
                });
            }
            continue;
        }

        return { reply: choice.content?.trim() || '', usedTools, model: lastModel };
    }

    // Витки кончились, а ответа нет — честно говорим об этом, а не выдаём
    // последнюю реплику модели за вывод.
    return {
        reply: 'Не смогла собрать ответ: слишком много обращений к данным подряд. Спроси уже, пожалуйста.',
        usedTools,
        model: lastModel,
    };
}

/** Последние реплики разговора, от старых к новым — как их читает модель. */
export async function loadHistory(limit = HISTORY_DEPTH): Promise<Array<{ role: string; text: string }>> {
    const { data, error } = await supabase
        .from('shtab_tamara_message')
        .select('role, text')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).reverse();
}

export function formatHistory(history: Array<{ role: string; text: string }>): string {
    if (history.length === 0) return 'Разговора ещё не было.';
    return history.map((m) => `${m.role === 'user' ? 'Владелец' : 'Тамара'}: ${m.text}`).join('\n');
}

/**
 * Понедельник недели, к которой относится момент, в виде YYYY-MM-DD.
 *
 * Неделя начинается с понедельника, а не с воскресенья: сводка приходит утром
 * в понедельник и относится к прошедшей рабочей неделе. Считается по UTC —
 * тем же временем, в котором Vercel запускает cron, иначе на границе суток
 * сводка попадала бы то в одну неделю, то в другую.
 */
export function weekStart(now: Date): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const shift = (d.getUTCDay() + 6) % 7; // у воскресенья getUTCDay() === 0, а до понедельника шесть дней назад
    d.setUTCDate(d.getUTCDate() - shift);
    return d.toISOString().slice(0, 10);
}

/**
 * Разбирает ответ, полученный со схемой.
 *
 * Пустой ответ и неразобранный JSON — это не «модель немного ошиблась», а
 * отсутствие результата: дальше по этому объекту сохраняют программу в базу.
 * Поэтому здесь бросаем, а не возвращаем половину.
 */
export function parseStructured<T>(reply: string, what: string): T {
    const text = (reply || '').trim();
    if (!text) throw new Error(`${what}: модель вернула пустой ответ`);
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`${what}: ответ модели не разобрался как JSON`);
    }
}
