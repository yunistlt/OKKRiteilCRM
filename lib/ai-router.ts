
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
    systemContext?: { currentTime: string, orderUpdatedAt: string }
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

    const systemPrompt = `
Ты - ассистент для обработки заказов в статусе "Согласование Отмены".
${contextPrompt}
Твоя задача: на основе комментария менеджера определить, в какой статус нужно перевести заказ.

Доступные статусы:

${statusList}

ВАЖНЫЕ ПРАВИЛА:
1. STRICT TAIL ANALYSIS (ПРАВИЛО КОНЦА): Ты обязан проанализировать текст В ОБРАТНОМ ПОРЯДКЕ (с конца). Самое последнее предложение или блок текста, даже если в нем нет даты — это и есть текущий статус заказа. 
   - Игнорируй всё, что написано в середине или начале, если оно противоречит финальному предложению.
   - Пример: если в середине "клиент недоступен", а в конце "купил у других" — правильный статус "Купили в другом месте".
2. ХРОНОЛОГИЯ И ДАТЫ: Менеджеры пишут даты в форматах "13.10" (13 октября) или "1.11" (1 ноября). 
   - СРАВНИВАЙ эти ручные записи с системным временем (${systemContext?.orderUpdatedAt || 'неизвестно'}). 
   - Если текст заканчивается записью "1.11 нашли слесаря...", то для системы это самая свежая информация от ${systemContext?.orderUpdatedAt || 'текущего момента'}, и она ВАЖНЕЕ чем любая предыдущая запись о недоступности.
3. КУПИЛИ У ДРУГИХ / РЕШИЛИ САМИ: Любое упоминание того, что клиент решил проблему сам или с другими (сделали сами, нашли другого мастера, купили в другом месте) -> статус "cancel-other".
4. РАБОЧИЕ СТАТУСЫ: Если в финальной фразе процесс продолжается (считаем, ждем, уточняем), выбери рабочий статус.
5. ПРИЧИНЫ ОТМЕНЫ: Выбирай только если процесс ОКОНЧАТЕЛЬНО завершен и нет признаков работы.

Верни ТОЛЬКО JSON (без markdown):
{
  "target_status": "код_статуса",
  "confidence": 0.0-1.0,
  "reasoning": "Краткое объяснение. ОБЯЗАТЕЛЬНО начни с цитирования САМОЙ ПОСЛЕДНЕЙ фразы из комментария, на которой основан выбор."
}
`;

    try {
        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Комментарий менеджера: "${comment || '(пусто)'}"` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2, // Low temperature for consistent decisions
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
