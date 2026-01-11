
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
    confidence: number;
    reasoning: string;
    was_applied: boolean;
    error?: string;
}

/**
 * Analyze manager comment to determine target status for order routing
 */
export async function analyzeOrderForRouting(
    comment: string,
    allowedStatuses: Map<string, string>
): Promise<RoutingDecision> {
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
- Если комментарий пустой или неинформативный ("ок", "тест", "+") -> используй "otmenen-propala-neobkhodimost"
- Если упоминается цена/дорого/дешевле -> "otmenili-zakupku-v-svyazi-s-nedostatochnym-finansirovaniem"
- Если упоминается отсутствие товара/нет на складе -> "net-takikh-pozitsii"
- Если упоминаются сроки/долго/поздно -> "no-product"
- Если клиент не отвечает/не берёт трубку -> "zakazchik-ne-vykhodit-na-sviaz"
- Если клиент передумал/отказался -> "otmenen-propala-neobkhodimost"
- Если купили у конкурента -> "cancel-other"
- Если заказ ещё в работе/нужно уточнить -> используй рабочий статус из списка
- Если уверенность < 0.7, используй "otmenen-propala-neobkhodimost" (безопасный вариант)

Верни ТОЛЬКО JSON (без markdown):
{
  "target_status": "код_статуса",
  "confidence": 0.0-1.0,
  "reasoning": "Краткое объяснение на русском (1-2 предложения)"
}
`;

    try {
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
