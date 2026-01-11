
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
    allowedStatuses: Map<string, string>
): Promise<RoutingDecision> {
    const comment = cleanComment(rawComment);

    // Build status list for prompt
    const statusList = Array.from(allowedStatuses.entries())
        .map(([code, name], i) => `${i + 1}. "${code}" - ${name}`)
        .join('\n');

    const systemPrompt = `
Ты - ассистент для обработки заказов в статусе "Согласование Отмены".

Твоя задача: на основе комментария менеджера определить, в какой статус нужно перевести заказ.

Доступные статусы:

${statusList}

ВАЖНЫЕ ПРАВИЛА:
1. ХРОНОЛОГИЯ И ДАТЫ: Комментарий — это хронологический лог. Entries часто начинаются с дат в разных форматах: "05.08.2025", "13.10", "1.11", "01.11". 
   - **Самая свежая информация находится в САМОМ КОНЦЕ текста**. 
   - Всегда читай до последнего символа! Если текст заканчивается фразой после даты, это и есть текущая ситуация.
2. КУПИЛИ У ДРУГИХ / РЕШИЛИ САМИ: Если в последних записях указано, что клиент "купил в другом месте", "сделал сам", "нашел другого исполнителя", "сделали из дерева" (не у нас) -> выбери "cancel-other" (Купили в другом месте).
3. РАБОЧИЕ СТАТУСЫ: Если в последней записи процесс продолжается (ждем ТЗ, считаем, уточняем, "ответит потом"), выбери соответствующий рабочий статус (например, "v-proscete", "na-soglasovanii", "raschet").
4. ПРИЧИНЫ ОТМЕНЫ:
   - Цена/дорого -> "otmenili-zakupku-v-svyazi-s-nedostatochnym-finansirovaniem"
   - Не отвечает/недоступен (только если это ПОСЛЕДНЯЯ запись) -> "zakazchik-ne-vykhodit-na-sviaz"
   - Долго -> "no-product"
   - Просто передумал -> "otmenen-propala-neobkhodimost"
5. ЕСЛИ ПОСЛЕДНЯЯ ЗАПИСЬ ПРОТИВОРЕЧИТ ПРЕДЫДУЩЕЙ: Например, если раньше было "не доступен", а в конце "купил у других" — приоритет всегда у КОНЦА текста.

Верни ТОЛЬКО JSON (без markdown):
{
  "target_status": "код_статуса",
  "confidence": 0.0-1.0,
  "reasoning": "Краткое объяснение на русском (1-2 предложения), четко указывающее, какую именно ПОСЛЕДНЮЮ фразу из конца комментария ты использовал."
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
