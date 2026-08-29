import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import {
    formatConsultantKnowledgeContext,
    getConsultantPromptConfig,
    searchConsultantKnowledge,
} from '@/lib/okk-consultant-ai';
import { buildConsultantTools, executeConsultantTool } from '@/lib/consultant-tools';

// Семён в личке у менеджера.
//
// Мозг не новый: тот же промпт, те же знания, те же инструменты, что и в
// консультанте ОКК. Разный только канал — и от канала зависит форма ответа.
// В интерфейсе можно развернуть таблицу и три абзаца, в телефоне читают пять
// строк, поэтому здесь ответ короче и без разметки, которую Telegram не покажет.
//
// Кто может спрашивать: только менеджеры, которым бот шлёт планы. Это не
// скупость, а безопасность — у Семёна есть инструменты по заказам и зарплате,
// и отвечать ими случайному человеку, написавшему боту, нельзя.

const MAX_TOOL_ITERATIONS = 6;
const MAX_ANSWER_CHARS = 1400;

export type AskResult = { reply: string; usedTools: string[]; model: string | null };

/** Менеджер по chat_id: отвечаем только тем, кого знаем. */
export async function managerByChat(chatId: string): Promise<{ managerId: number; name: string } | null> {
    const { data } = await supabase
        .from('sales_rop_manager')
        .select('manager_id')
        .eq('telegram_chat_id', String(chatId))
        .eq('is_active', true)
        .maybeSingle();
    if (!data) return null;

    const { data: m } = await supabase
        .from('managers')
        .select('id, first_name, last_name')
        .eq('id', data.manager_id)
        .maybeSingle();

    return {
        managerId: Number(data.manager_id),
        name: m ? `${m.last_name ?? ''} ${m.first_name ?? ''}`.trim() : String(data.manager_id),
    };
}

async function loadManagerPrompt(): Promise<{ systemPrompt: string; model: string; temperature: number }> {
    const { data } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature')
        .eq('key', 'semen_manager_chat')
        .eq('is_active', true)
        .maybeSingle();
    if (data) {
        return {
            systemPrompt: data.system_prompt,
            model: data.model || 'gpt-4o',
            temperature: Number(data.temperature ?? 0.3),
        };
    }
    // Промпта нет — берём общий, он хотя бы не выдумывает.
    const fallback = await getConsultantPromptConfig('okk_consultant_global_chat');
    return { systemPrompt: fallback.systemPrompt, model: fallback.model, temperature: fallback.temperature };
}

export async function askSemen(params: {
    question: string;
    managerId: number;
    managerName: string;
}): Promise<AskResult> {
    if (!isOpenAIConfigured()) {
        return { reply: 'Модель не настроена — не могу ответить.', usedTools: [], model: null };
    }

    // Свой промпт для этого канала. Глобальный промпт Семёна написан для
    // консультанта по системе и на вопрос «сколько счетов на оплате» отвечает
    // «в базе знаний не нашлось» — в вебе это правильно, в личке это тупик.
    const prompt = await loadManagerPrompt();
    const hits = await searchConsultantKnowledge(params.question).catch(() => []);

    const ctx = { retailCrmManagerId: params.managerId, role: 'manager' } as any;
    const tools = buildConsultantTools(ctx);

    const messages: any[] = [
        {
            role: 'system',
            content:
                `${prompt.systemPrompt}\n\n` +
                `Ты отвечаешь ${params.managerName} в личном чате Telegram. Пиши коротко: пять-шесть строк, без таблиц и без markdown-разметки — её тут не видно. ` +
                '\n\n' +
                formatConsultantKnowledgeContext(hits as any),
        },
        { role: 'user', content: params.question },
    ];

    const openai = getOpenAIClient();
    const usedTools: string[] = [];
    let model: string | null = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
        const completion = await openai.chat.completions.create({
            model: prompt.model || 'gpt-4o',
            temperature: Number(prompt.temperature ?? 0.3),
            max_tokens: 700,
            messages,
            tools: tools as any,
        } as any);

        model = completion.model;
        await recordAiUsage({
            agentId: AiAgent.SEMEN,
            model: completion.model,
            usage: completion.usage,
            purpose: 'semen_telegram',
        }).catch(() => null);

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
                usedTools.push(name);
                const result = await executeConsultantTool(name, args, ctx).catch((e: any) => ({
                    available: false,
                    reason: e.message,
                }));
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
            }
            continue;
        }

        const text = (choice.content || '').trim();
        return {
            reply: text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}…` : text,
            usedTools,
            model,
        };
    }

    // Инструменты закончились, а ответа нет: честнее сказать это, чем выдать
    // последнюю реплику модели, которая обрывается на середине рассуждения.
    return { reply: 'Не смог собрать ответ по данным. Спроси иначе или назови номер заказа.', usedTools, model };
}
