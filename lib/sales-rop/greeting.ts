import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';

/**
 * Приветствие и прощание, которые бот сочиняет сам.
 *
 * Один и тот же текст каждое утро перестают читать на второй неделе: глаз
 * пропускает знакомую строку вместе с тем, что идёт следом. Живое обращение —
 * не украшение, а способ, чтобы план вообще открыли.
 *
 * Шаблон из настроек остаётся: он работает, когда модель недоступна или когда
 * генерацию выключили. Молчаливого «без приветствия» не бывает ни при какой
 * поломке — сообщение всегда начинается по-человечески.
 */

export type Greeting = { greeting: string; farewell: string };

/** День недели и число словами: понедельник и пятница — разные утра. */
function dayWords(date: Date): string {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
}

export function fallbackGreeting(template: string, farewell: string): Greeting {
    return { greeting: template, farewell };
}

/**
 * Сгенерировать пару строк для одного человека.
 *
 * Имя и день передаём готовыми — модель не должна их выдумывать. Число задач
 * даём, чтобы тон подходил дню: «двадцать дел» и «три дела» требуют разного.
 */
export async function generateGreeting(params: {
    firstName: string;
    date: Date;
    tasks: number;
    amount: number;
}): Promise<Greeting | null> {
    if (!isOpenAIConfigured()) return null;

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', 'sales_rop_greeting')
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt) return null;

    try {
        const openai = getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: (prompt as any).model || 'gpt-4o-mini',
            // Температура высокая намеренно: одинаковые приветствия — ровно то,
            // от чего мы уходим.
            temperature: Number((prompt as any).temperature ?? 1),
            max_tokens: Number((prompt as any).max_tokens ?? 200),
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: (prompt as any).system_prompt },
                {
                    role: 'user',
                    content: JSON.stringify({
                        имя: params.firstName,
                        день: dayWords(params.date),
                        задач_на_день: params.tasks,
                        сумма_в_работе: Math.round(params.amount),
                        // Иначе модель пишет всем одно и то же: «четверг —
                        // отличный день». Вариант задаёт, о чём говорить, а
                        // расшифровка вариантов живёт в промпте.
                        вариант: 1 + Math.floor(Math.random() * 6),
                    }),
                },
            ],
        });

        await recordAiUsage({
            agentId: AiAgent.SALES_ANALYST,
            model: completion.model,
            usage: completion.usage,
            purpose: 'sales_rop_greeting',
        }).catch(() => null);

        const raw = completion.choices[0]?.message?.content || '';
        const parsed = JSON.parse(raw) as { greeting?: string; farewell?: string };
        const greeting = String(parsed.greeting ?? '').trim();
        const farewell = String(parsed.farewell ?? '').trim();
        if (!greeting || !farewell) return null;

        // Две строки, не сочинение: длинное приветствие съедает сам план.
        if (greeting.length > 200 || farewell.length > 200) return null;
        return { greeting, farewell };
    } catch {
        // Приветствие — оболочка вокруг плана. Из-за него план не должен пропасть.
        return null;
    }
}
