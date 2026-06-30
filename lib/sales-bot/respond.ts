// Ядро бота-продажника (канало-независимое).
// Поток: роутер (домен → продажа/спор) → если спор: эскалация юристу;
//        если продажа: поиск в РАГ (только bot_can_answer) → генерация ответа.
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { searchDialogKnowledge, formatKnowledgeForPrompt } from './retrieval';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';
import {
    type DialogDomain,
    type SalesBotInput,
    type SalesBotResult,
    isDisputeDomain,
} from './types';

const VALID_DOMAINS: DialogDomain[] = [
    'продажа', 'товар', 'логистика_сроки', 'рекламация', 'возврат', 'суд_претензия', 'прочее',
];

const MAX_KNOWLEDGE_HITS = 5;
const KNOWLEDGE_THRESHOLD = 0.42;

type PromptKey = 'sales_bot_router' | 'sales_bot_responder';

type PromptConfig = {
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
};

// Дефолты — на случай, если строки промптов ещё не засеяны в ai_prompts.
const DEFAULT_PROMPTS: Record<PromptKey, PromptConfig> = {
    sales_bot_router: {
        systemPrompt: [
            'Ты — классификатор обращений клиента на заводе металлоконструкций (ЗМК).',
            'Определи домен последнего сообщения клиента: продажа, товар, логистика_сроки, рекламация, возврат, суд_претензия, прочее.',
            'При ЛЮБОМ признаке спора (брак, претензия, «верните деньги», суд, юрист, неустойка) ставь спорный домен (рекламация/возврат/суд_претензия).',
            'Отвечай строго JSON: {"domain":"...","reason":"кратко"}',
        ].join(' '),
        userPromptTemplate: 'История:\n{{history_context}}\n\nСообщение клиента: {{message}}',
        model: 'gpt-4o-mini',
        temperature: 0,
        maxTokens: 80,
    },
    sales_bot_responder: {
        systemPrompt: [
            'Ты — менеджер по продажам завода металлоконструкций (ЗМК). Общаешься с клиентом вежливо, по-деловому, кратко.',
            'Опирайся на приёмы из похожих успешных разговоров и на факты заказа, если они даны.',
            'НЕ выдумывай цены, сроки, характеристики, наличие — если точных данных нет, скажи, что уточнишь, и задай уточняющий вопрос.',
            'НЕ обсуждай возвраты денег, претензии, брак, суды — это ведёт юрист; такие темы сюда не попадают.',
            'Цель — вести клиента к покупке: ответить на вопрос и предложить следующий шаг.',
            'Пиши ответ как живое сообщение клиенту: НЕ начинай со слова «Менеджер» и не копируй служебные пометки из примеров.',
        ].join(' '),
        userPromptTemplate: [
            'Сообщение клиента: {{message}}',
            '',
            'Похожие успешные разговоры (как отвечали наши менеджеры):',
            '{{knowledge_context}}',
            '',
            'Контекст заказа клиента:',
            '{{order_context}}',
            '',
            'История диалога:',
            '{{history_context}}',
        ].join('\n'),
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 320,
    },
};

// Сообщение клиенту при передаче спорной темы юристу.
const ESCALATION_REPLY =
    'Этот вопрос ведёт наш юрист — я передал ваше обращение ответственному специалисту, он свяжется с вами. Если у вас есть вопросы по продукции или новому заказу, я с радостью помогу.';

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => values[key] ?? '—');
}

async function getPrompt(key: PromptKey): Promise<PromptConfig> {
    try {
        const { data } = await supabase
            .from('ai_prompts')
            .select('system_prompt, user_prompt_template, model, temperature, max_tokens')
            .eq('key', key)
            .eq('is_active', true)
            .maybeSingle();
        if (data) {
            return {
                systemPrompt: data.system_prompt || DEFAULT_PROMPTS[key].systemPrompt,
                userPromptTemplate: data.user_prompt_template || DEFAULT_PROMPTS[key].userPromptTemplate,
                model: data.model || DEFAULT_PROMPTS[key].model,
                temperature: data.temperature ?? DEFAULT_PROMPTS[key].temperature,
                maxTokens: data.max_tokens ?? DEFAULT_PROMPTS[key].maxTokens,
            };
        }
    } catch (error) {
        console.warn(`[sales-bot] Failed to load prompt ${key}, using default.`, error);
    }
    return DEFAULT_PROMPTS[key];
}

function summarizeHistory(history: SalesBotInput['history']): string {
    if (!history?.length) return 'Начало диалога.';
    return history
        .slice(-6)
        .map((t) => `${t.role === 'client' ? 'Клиент' : 'Бот'}: ${t.text}`)
        .join('\n');
}

async function classifyDomain(message: string, historyContext: string): Promise<DialogDomain> {
    const prompt = await getPrompt('sales_bot_router');
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: prompt.model,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: renderTemplate(prompt.userPromptTemplate, { message, history_context: historyContext }) },
        ],
    });
    await recordAiUsage({ agentId: AiAgent.ELENA, model: completion.model, usage: completion.usage, purpose: 'sales_bot_router' });
    try {
        const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
        const domain = String(parsed.domain || '').trim();
        if ((VALID_DOMAINS as string[]).includes(domain)) return domain as DialogDomain;
    } catch {
        // ignore — ниже фолбэк
    }
    return 'прочее';
}

/**
 * Главная функция ядра. Возвращает либо ответ бота, либо решение об эскалации юристу.
 * Безопасность границы — в трёх местах: роутер ловит спор, поиск идёт с
 * only_bot_answerable=true, а при спорном домене мы вообще не генерируем ответ.
 */
export async function salesBotRespond(input: SalesBotInput): Promise<SalesBotResult> {
    const message = (input.message || '').trim();
    const historyContext = summarizeHistory(input.history);
    const orderContext = input.orderContext?.trim() || 'Заказ не определён.';

    if (!isOpenAIConfigured()) {
        return {
            action: 'escalate',
            domain: 'прочее',
            reply: 'Сейчас не могу ответить автоматически — передаю менеджеру.',
            knowledge: [],
            meta: { routed: 'прочее', escalated: true, knowledgeCount: 0, promptKeys: [] },
        };
    }

    // 1) Роутер: определяем домен.
    const domain = await classifyDomain(message, historyContext);

    // 2) Спорная тема → эскалация юристу, без генерации ответа по существу.
    if (isDisputeDomain(domain)) {
        return {
            action: 'escalate',
            domain,
            reply: ESCALATION_REPLY,
            escalateTo: 'lawyer',
            knowledge: [],
            meta: { routed: domain, escalated: true, knowledgeCount: 0, promptKeys: ['sales_bot_router'] },
        };
    }

    // 3) Продажа/товар/логистика → поиск приёмов (только bot_can_answer) + генерация.
    const hits = await searchDialogKnowledge(message, {
        topK: MAX_KNOWLEDGE_HITS,
        threshold: KNOWLEDGE_THRESHOLD,
        onlyBotAnswerable: true,
    });

    const prompt = await getPrompt('sales_bot_responder');
    const openai = getOpenAIClient();
    const userPrompt = renderTemplate(prompt.userPromptTemplate, {
        message,
        knowledge_context: formatKnowledgeForPrompt(hits),
        order_context: orderContext,
        history_context: historyContext,
    });
    const completion = await openai.chat.completions.create({
        model: prompt.model,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    });
    await recordAiUsage({ agentId: AiAgent.ELENA, model: completion.model, usage: completion.usage, purpose: 'sales_bot_responder' });

    const reply = completion.choices[0]?.message?.content?.trim()
        || 'Уточню детали и вернусь с ответом. Подскажите, что именно вас интересует по заказу?';

    return {
        action: 'reply',
        domain,
        reply,
        knowledge: hits,
        meta: {
            routed: domain,
            escalated: false,
            knowledgeCount: hits.length,
            promptKeys: ['sales_bot_router', 'sales_bot_responder'],
        },
    };
}
