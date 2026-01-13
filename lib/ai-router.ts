
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

/**
 * Analyze manager comment to determine target status for order routing
 */
export async function analyzeOrderForRouting(
    rawComment: string,
    allowedStatuses: Map<string, string>,
    systemContext?: { currentTime: string, orderUpdatedAt: string },
    auditContext?: { latestCallTranscript?: string, latestEmailText?: string }
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

    const systemPrompt = `
Ты - аудитор ОКК (Отдел Контроля Качества).
Твоя задача: на основе комментария менеджера и данных аудита определить верный статус заказа.
Сейчас заказ находится в статусе "Согласование Отмены". Менеджер хочет его отменить.

${contextPrompt}
${auditPrompt}

Доступные статусы для перевода:
${statusList}

ПРАВИЛА ПРИНЯТИЯ РЕШЕНИЙ:
1. ОБОСНОВАННАЯ ОТМЕНА:
   - Если клиент отказался, передумал, купил в другом месте, или игнорирует (и это подтверждается аудитом/комментарием) -> Выбирай подходящий статус ОТМЕНЫ (например, "otmenen-propala-neobkhodimost", "cancel-other").

2. ВОЗВРАТ В РАБОТУ (Смена статуса на "В работе", "Новый" и т.д.):
   - Если в звонке/переписке клиент говорит "Я подумаю", "Пришлите счет", "Давайте позже", "Не отменяйте" -> ЭТО НЕ ОТМЕНА.
   - Если менеджер ошибся и отправил в отмену, а работа идет -> ВЕРНИ В РАБОТУ.
   - Выбери из списка "Доступные статусы" наиболее подходящий РАБОЧИЙ статус (например "work", "new", "in-progress"). Если точного рабочего статуса нет в списке, верни "soglasovanie-otmeny" с комментарием "Требуется вернуть в работу, но нет подходящего статуса".

3. КОНФЛИКТ / НЕЯСНОСТЬ (Оставить в "soglasovanie-otmeny"):
   - Если есть прямое противоречие (менеджер пишет "отказ", а в звонке клиент просит счет) и ты не уверен, какой рабочий статус выбрать -> оставь "soglasovanie-otmeny".
   - В поле reasoning ОБЯЗАТЕЛЬНО укажи причину сомнений.

4. STRICT TAIL ANALYSIS (Правило конца): Анализируй хронологию. Последнее событие важнее. Но слова клиента ("Не отменяйте") важнее мнения менеджера ("Он слился").

Верни ТОЛЬКО JSON:
{
  "target_status": "код_статуса",
  "confidence": 0.0-1.0,
  "reasoning": "Краткое обоснование. Если возвращаешь в работу - напиши почему (напр. 'Клиент в звонке просил счет')."
}
`;

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

        // Validate against allowed statuses
        const validStatuses = Array.from(allowedStatuses.keys());

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
