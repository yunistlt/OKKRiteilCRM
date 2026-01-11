
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
export async function analyzeOrderForRouting(comment: string): Promise<RoutingDecision> {
    const systemPrompt = `
Ты - ассистент для обработки заказов в статусе "Согласование Отмены".

Твоя задача: на основе комментария менеджера определить, в какой статус нужно перевести заказ.

Доступные статусы:
1. "otmenyon-klientom" - Отменён клиентом (клиент отказался от заказа, не хочет товар)
2. "otmenyon-postavschikom" - Отменён поставщиком (товара нет на складе, не можем выполнить заказ)
3. "work" - В работе (нужно уточнить детали, заказ продолжается, ждём ответа)
4. "novyi-1" - Новый (ошибочно попал в согласование, вернуть в начало воронки)

ВАЖНО:
- Если уверенность < 0.7, используй статус "work" (безопасный вариант для ручной проверки)
- Если комментарий пустой или неинформативный ("ок", "тест", "+"), используй "work"
- Если упоминается отсутствие товара/проблемы с поставкой -> "otmenyon-postavschikom"
- Если клиент явно отказывается/передумал -> "otmenyon-klientom"

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

        // Validate and sanitize
        const validStatuses = ['otmenyon-klientom', 'otmenyon-postavschikom', 'work', 'novyi-1'];
        if (!validStatuses.includes(result.target_status)) {
            console.warn(`Invalid status "${result.target_status}", defaulting to "work"`);
            result.target_status = 'work';
            result.confidence = 0.5;
        }

        // Enforce minimum confidence threshold
        if (result.confidence < 0.7) {
            result.target_status = 'work';
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
