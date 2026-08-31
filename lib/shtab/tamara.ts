import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { generateEmbedding } from '@/lib/embeddings';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { TAMARA_TOOLS, TAMARA_TOOL_NAMES, executeShtabTool } from '@/lib/shtab/tamara-tools';

// Разговорный слой Тамары.
//
// Устроен как у Семёна (app/api/okk/consultant/route.ts): ограниченный цикл
// вызова инструментов, промпт из ai_prompts, знания из базы знаний, расход
// пишется в общий учёт. Отличие одно и принципиальное — набор инструментов и
// правило, что вне их Тамара о компании не знает ничего.

/**
 * Сколько раз подряд Тамара может сходить за данными внутри одного ответа.
 *
 * Пяти хватало на «посмотрел — ответил». Не хватало на то, ради чего она и
 * нужна: посмотреть, увидеть странное, полезть проверить, сопоставить с
 * третьим. Каждый виток — отдельный вызов модели, поэтому число не бесконечное:
 * оно ограничивает не мысль, а хождение кругами.
 */
const MAX_TOOL_ITERATIONS = 8;

/**
 * Ниже этой близости выдержка из знаний скорее мешает, чем помогает. Порог не
 * трогаем: снизить его — значит подмешивать в ответ статьи не по теме, и модель
 * начнёт отвечать по ним, а не по вопросу.
 */
const KNOWLEDGE_THRESHOLD = 0.35;

/**
 * Сколько выдержек берём. Это потолок, а не норма: порог выше всё равно
 * отсекает лишнее, и при узком вопросе вернётся одна-две. Четырёх на 58 статей
 * было мало там, где вопрос лежит на стыке нескольких правил методички.
 */
const KNOWLEDGE_LIMIT = 8;

/**
 * Сколько последних реплик отдаём модели как контекст разговора.
 *
 * Восьми не хватает на разбор, который идёт полдня: начало обсуждения выпадает
 * ровно тогда, когда к нему возвращаются. Блок ПАМЯТЬ это не заменяет — там
 * лежат выясненные факты, а не ход рассуждения.
 */
const HISTORY_DEPTH = 16;

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
        // Подстановки на случай пустого поля. Раньше здесь стояли gpt-4o-mini и
        // 900 токенов: очищенное в админке поле молча роняло Тамару на слабую
        // модель и короткий ответ, и понять это по её ответам было бы нельзя —
        // она просто начала бы хуже думать.
        model: data.model || 'gpt-4.1',
        temperature: Number(data.temperature ?? 0.3),
        maxTokens: Number(data.max_tokens ?? 2000),
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
    /**
     * Блок ПАМЯТЬ — что о компании уже выяснено. Идёт в системное сообщение, а
     * не в шаблон пользовательского: шаблон лежит в базе и правится в админке, а
     * память обязана быть перед глазами всегда. Забытая подстановка означала бы,
     * что Тамара спрашивает второй раз про то же, — и виноват был бы не промпт.
     */
    memory?: string;
}): Promise<TamaraAnswer> {
    if (!isOpenAIConfigured()) {
        return { reply: 'Модель не настроена: нет OPENAI_API_KEY.', usedTools: [], model: null };
    }
    const openai = getOpenAIClient();
    const usedTools: Array<{ name: string; args: unknown }> = [];
    let lastModel: string | null = null;

    const GUARDRAIL =
        'Отвечай только тем, что вернули инструменты, что лежит в блоке ПАМЯТЬ и что владелец сказал в этом разговоре. ' +
        'Любое число или факт о компании из другого места называть запрещено. Не хватает факта — задай один прямой вопрос ' +
        'и запиши ответ инструментом shtab_zapomnit; выдуманный правдоподобный факт хуже прямого «не знаю», потому что его не проверяют.';

    const system = [opts.prompt.systemPrompt, GUARDRAIL, opts.memory?.trim()].filter(Boolean).join('\n\n');

    const messages: any[] = [
        { role: 'system', content: system },
        { role: 'user', content: opts.userContent },
    ];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const completion = await openai.chat.completions.create({
            model: opts.prompt.model,
            temperature: opts.prompt.temperature,
            max_tokens: opts.prompt.maxTokens,
            messages,
            ...(opts.withTools === false ? {} : { tools: TAMARA_TOOLS as any }),
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
                const result = TAMARA_TOOL_NAMES.has(name)
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
