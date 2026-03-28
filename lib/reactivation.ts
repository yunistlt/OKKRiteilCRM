/**
 * lib/reactivation.ts
 * ИИ-Агент «Виктория»: генерация писем + анализ ответов клиентов
 * Все промпты настраиваются через настройки кампании — не захардкожены.
 */

import OpenAI from 'openai';
import { supabase } from '@/utils/supabase';

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

// ─────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────

export interface EmailGenerationContext {
    company_name: string;
    contact_person?: string; // Имя контактного лица (ФИО)
    orders_history: string;
    manager_comments: string;
    custom_prompt?: string;
    
    // Новые поля для гипер-персонализации
    industry?: string;       // Сфера деятельности
    category?: string;       // Категория товара
    total_summ?: number;     // LTV
    orders_count?: number;   // Кол-во заказов
    average_check?: number;  // Средний чек
    call_transcripts?: string; // Текст последних звонков
}

export interface GeneratedEmail {
    body: string;
    reasoning: string;
}

export type IntentStatus = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface ReplyAnalysis {
    intent: IntentStatus;
    reason: string;
}

// ─────────────────────────────────────────────
// Дефолтный промпт Виктории-Писателя
// Можно переопределить через campaign.settings.victoria_prompt
// ─────────────────────────────────────────────

export const DEFAULT_VICTORIA_PROMPT = `Ты B2B-менеджер по оптовым продажам производственной компании (сушильные шкафы, стеллажи, верстаки).
Твоя задача — написать персональное, вежливое и ненавязчивое письмо для возобновления сотрудничества с компанией-клиентом.

Правила:
1. Опирайся на историю: если раньше покупали шкафы — спроси, как оборудование показывает себя в деле и не нужно ли дооснащение. Если отменили заказ — аккуратно спроси про текущие объекты/тендеры.
2. Никаких шаблонных фраз ("Уникальное предложение", "Специально для вас").
3. Письмо короткое — 3-4 абзаца. Заканчивается открытым вопросом.
4. Создай ощущение, что менеджер лично помнит историю работы с этой компанией.
5. Не упоминай, что письмо написано автоматически или при помощи ИИ.`;

// ─────────────────────────────────────────────
// ✍️ ВИКТОРИЯ-ПИСАТЕЛЬ (Writer)
// Составляет персонализированное письмо на основе карточки клиента.
// Промпт настраивается из UI кампании (custom_prompt).
// По умолчанию — DEFAULT_VICTORIA_PROMPT из AI_STAFF_ROLES.md.
// ─────────────────────────────────────────────

export async function generateReactivationEmail(ctx: EmailGenerationContext): Promise<GeneratedEmail> {
    const openai = getOpenAI();

    const basePrompt = ctx.custom_prompt?.trim() || DEFAULT_VICTORIA_PROMPT;
    const systemPrompt = `
${basePrompt}

ОБЯЗАТЕЛЬНО верни ответ строго в формате JSON:
{
  "reasoning": "Краткое обоснование: почему выбрана именно такая стратегия письма (на основе истории заказов и комментариев)",
  "body": "Текст самого письма для клиента"
}
`;

    // 0. Интеграция с Еленой (Продуктологом): поиск документации
    let productSpecsContext = '';
    try {
        const { data: knowledge } = await supabase
            .from('product_knowledge')
            .select('name, category, description, tech_specs, pain_points, solved_tasks, use_cases');
        
        // Маппинг для тех товаров, что упоминаются в истории
        const relevantSpecs = knowledge?.filter(k => ctx.orders_history.includes(k.name)) || [];
        if (relevantSpecs.length > 0) {
            productSpecsContext = `\nИНСАЙТЫ ПО ПРОДУКЦИИ ОТ ЕЛЕНЫ (ПРОДУКТОЛОГА):\n` +
                relevantSpecs.map(k => 
                    `- ${k.name} [${k.category}]: ${k.description}.\n` +
                    `  * Боли клиента: ${k.pain_points?.join(', ') || '—'}\n` +
                    `  * Решаемые задачи: ${k.solved_tasks?.join(', ') || '—'}\n` +
                    `  * Тех. данные (ТТХ): ${JSON.stringify(k.tech_specs)}`
                ).join('\n');
        }
    } catch (e) {
        console.error('[Reactivation] Elena Lookup Error:', e);
    }

    const userMessage = `Информация о компании: ${ctx.company_name}
${ctx.contact_person ? `Контактное лицо (обращайся по имени): ${ctx.contact_person}` : ''}

${ctx.industry ? `Сфера деятельности клиента: ${ctx.industry}` : ''}
${ctx.category ? `Основная категория интереса: ${ctx.category}` : ''}

Статистика клиента в нашей базе:
- Всего заказов: ${ctx.orders_count || 0}
- Общая сумма (LTV): ${ctx.total_summ || 0} ₽
- Средний чек: ${ctx.average_check || 0} ₽

История заказов клиента:
${ctx.orders_history}

${productSpecsContext}

Последние комментарии наших менеджеров по этому клиенту:
${ctx.manager_comments || '(комментарии отсутствуют)'}

${ctx.call_transcripts ? `История последних телефонных разговоров (кратко):
${ctx.call_transcripts}` : ''}

Напиши письмо для возобновления сотрудничества.`;

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 800,
    });

    const raw = completion.choices[0].message.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    try {
        const parsed = JSON.parse(raw);
        return {
            body: parsed.body ?? '',
            reasoning: parsed.reasoning ?? ''
        };
    } catch (e) {
        console.error('[Victoria Writer] JSON Parse Error:', e);
        return {
            body: raw,
            reasoning: 'Не удалось спарсить структурированное обоснование'
        };
    }
}

// ─────────────────────────────────────────────
// 🧠 ВИКТОРИЯ-АНАЛИТИК (Analyst)
// Классифицирует ответы клиентов: POSITIVE / NEGATIVE / NEUTRAL.
// Промпт фиксированный — стандарт классификации, не настраивается из UI.
// ─────────────────────────────────────────────

const VICTORIA_ANALYST_SYSTEM = `Ты руководитель отдела B2B продаж. Твоя задача — проанализировать ответ клиента на письмо о возобновлении сотрудничества.

Классифицируй ответ строго в одну из трёх категорий:
- POSITIVE: клиент просит прайс, задаёт вопрос по характеристикам, просит счёт, готов к общению
- NEGATIVE: просит больше не писать, хамство, пишет что закрылись, не актуально
- NEUTRAL: просит перезвонить через полгода, "пока не надо, но имеем в виду"

Верни ответ строго в формате JSON:
{
  "intent": "POSITIVE | NEGATIVE | NEUTRAL",
  "reason": "Краткое обоснование"
}`;

export async function analyzeClientReply(replyText: string): Promise<ReplyAnalysis> {
    const openai = getOpenAI();

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: VICTORIA_ANALYST_SYSTEM },
                { role: 'user', content: `Ответ клиента: "${replyText}"` },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        const raw = completion.choices[0].message.content;
        if (!raw) throw new Error('Empty response from OpenAI');

        const parsed = JSON.parse(raw);
        const intent: IntentStatus = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(parsed.intent)
            ? parsed.intent
            : 'NEUTRAL';

        return { intent, reason: parsed.reason ?? '' };
    } catch (e) {
        console.error('[Victoria Analyst] Error:', e);
        return { intent: 'NEUTRAL', reason: 'Ошибка анализа' };
    }
}

// ─────────────────────────────────────────────
// 📬 ВИКТОРИЯ-ОТВЕТЧИК (Responder)
// Пишет ответное письмо при POSITIVE, если on_positive=send_reply.
// Промпт настраивается из UI кампании (reply_prompt).
// ─────────────────────────────────────────────

export async function generateReplyEmail(opts: {
    company_name: string;
    original_email: string;
    client_reply: string;
    custom_prompt?: string;
}): Promise<string> {
    const openai = getOpenAI();

    const systemPrompt = opts.custom_prompt?.trim() ||
        `Ты B2B-менеджер. Клиент ответил на наше письмо о возобновлении сотрудничества. 
Напиши краткий, живой ответ менеджера (2-3 абзаца). Предложи следующий шаг (выслать прайс, позвонить, уточнить потребность).
Не упоминай ИИ.`;

    const userMessage = `Компания клиента: ${opts.company_name}

Наше письмо:
${opts.original_email}

Ответ клиента:
${opts.client_reply}

Напиши ответное письмо менеджера.`;

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 400,
    });

    return completion.choices[0].message.content?.trim() ?? '';
}
