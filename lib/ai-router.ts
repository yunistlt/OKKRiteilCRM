
// ОТВЕТСТВЕННЫЕ: 
// 1. АННА (Бизнес-аналитик) — Анализ комментариев менеджера для принятия решения.
// 2. МАКСИМ (Аудитор) — Финальная маршрутизация и смена статусов в CRM.
import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    return _openai;
}

export interface RoutingDecision {
    target_status: string;
    confidence: number;
    reasoning: string;
}

export interface RoutingOptions {
    dryRun?: boolean;
    limit?: number;
    minConfidence?: number;
}

export interface RoutingResult {
    order_id: number;
    from_status: string;
    current_status_name?: string;
    current_status_color?: string;
    total_sum?: number;
    retail_crm_url?: string;
    to_status: string;
    to_status_name?: string;
    confidence: number;
    reasoning: string;
    was_applied: boolean;
    error?: string;
    // Дополнительные поля для таблицы
    manager_name?: string;
    country?: string;
    category?: string;
    purchase_form?: string;
    sphere?: string;
    client_comment?: string;
    manager_comment?: string;
    logistic_comment?: string;
}

/**
 * Clean up manager comment by removing previous AI routing notes to avoid feedback loops
 */
function cleanComment(comment: string): string {
    if (!comment) return '';
    // Remove lines starting with "ОКК:" and double newlines
    return comment
        .split('\n')
        .filter(line => !line.trim().startsWith('ОКК:'))
        .join('\n')
        .trim();
}

import { DEFAULT_ROUTING_PROMPT } from '@/lib/prompts';

/**
 * Analyze manager comment to determine target status for order routing
 */
export async function analyzeOrderForRouting(
    rawComment: string,
    allowedStatuses: Map<string, string>,
    systemContext?: { currentTime: string, orderUpdatedAt: string },
    auditContext?: { latestCallTranscript?: string, latestEmailText?: string },
    customSystemPrompt?: string,
    annaInsights?: any,
    chosenReason?: string
): Promise<RoutingDecision> {
    const comment = cleanComment(rawComment);

    // Build status list for prompt
    const statusList = Array.from(allowedStatuses.entries())
        .map(([code, name], i) => `${i + 1}. "${code}" - ${name}`)
        .join('\n');

    const contextPrompt = systemContext
        ? `\nСИСТЕМНЫЙ КОНТЕКСТ:
- Текущее время сервера: ${systemContext.currentTime}
- Заказ обновлен (изменение комментария/статуса): ${systemContext.orderUpdatedAt}
\n` : '';

    const auditPrompt = auditContext
        ? `\nДАННЫЕ ДЛЯ АУДИТА (ТРОЙНАЯ ПРОВЕРКА):
${auditContext.latestCallTranscript ? `- ТРАНСКРИПТ ПОСЛЕДНЕГО ЗВОНКА: "${auditContext.latestCallTranscript}"` : '- Звонков с клиентом не найдено или они не транскрибированы.'}
${auditContext.latestEmailText ? `- ПОСЛЕДНЯЯ ПЕРЕПИСКА (EMAIL/ЧАТ): "${auditContext.latestEmailText}"` : '- Свежей переписки с клиентом не найдено.'}
\n` : '';

    const annaPrompt = annaInsights
        ? `\nЗАКЛЮЧЕНИЕ БИЗНЕС-АНАЛИТИКА (АННЫ):
"${annaInsights.summary || JSON.stringify(annaInsights)}"
${annaInsights.customer_profile?.client_resume ? `О клиенте: ${annaInsights.customer_profile.client_resume}` : ''}
${annaInsights.recommendations ? `Рекомендации: ${annaInsights.recommendations.join(', ')}` : ''}
\n` : '\n(Заключение аналитика отсутствует)\n';

    const chosenReasonPrompt = chosenReason 
        ? `\nВЕРИФИКАЦИЯ ПРИЧИНЫ ОТМЕНЫ (V2):
- Менеджер выбрал причину: "${chosenReason}"
- ТВОЯ ПЕРВООЧЕРЕДНАЯ ЗАДАЧА: Проверь, соответствует ли это реальности (звонкам и письмам). 
- Если причина ложная или не подтверждается — выбирай статус "Заявка квалифицирована" (zapros-kontaktov).
\n` : '';

    // Use custom prompt if provided, otherwise default
    // Replace {{placeholders}} with actual data
    let promptTemplate = customSystemPrompt || DEFAULT_ROUTING_PROMPT;

    // Safety check if template is empty
    if (!promptTemplate.trim()) {
        promptTemplate = DEFAULT_ROUTING_PROMPT;
    }

    const systemPrompt = promptTemplate
        .replace('{{contextPrompt}}', contextPrompt)
        .replace('{{auditPrompt}}', auditPrompt)
        .replace('{{statusList}}', statusList)
        .replace('{{annaInsights}}', annaPrompt)
        .replace('{{chosenReasonPrompt}}', chosenReasonPrompt)
        .replace('{{chosenReason}}', chosenReason || 'Не указана');

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Текст комментария менеджера: "${comment || '(пусто)'}"` }
            ],
            response_format: { type: "json_object" },
            temperature: 0, // Zero temperature for audit precision
        });

        const content = completion.choices[0].message.content;
        if (!content) throw new Error('No content from LLM');

        const result = JSON.parse(content);

        // Validate against allowed statuses (always allow zapros-kontaktov as it is a return-to-work status)
        const validStatuses = [...Array.from(allowedStatuses.keys()), 'zapros-kontaktov'];

        if (!validStatuses.includes(result.target_status)) {
            console.warn(`Invalid status "${result.target_status}", defaulting to "otmenen-propala-neobkhodimost"`);
            result.target_status = 'otmenen-propala-neobkhodimost';
            result.confidence = 0.5;
        }

        // Enforce minimum confidence threshold
        if (result.confidence < 0.7) {
            result.target_status = 'otmenen-propala-neobkhodimost';
            result.reasoning += ' (Низкая уверенность - требуется ручная проверка)';
        }

        return {
            target_status: result.target_status,
            confidence: result.confidence,
            reasoning: result.reasoning
        };

    } catch (e) {
        console.error('AI Routing Analysis Error:', e);
        return {
            target_status: 'work',
            confidence: 0,
            reasoning: 'Ошибка анализа - требуется ручная проверка'
        };
    }
}
