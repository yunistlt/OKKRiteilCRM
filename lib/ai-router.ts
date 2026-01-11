
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
1. ХРОНОЛОГИЯ: Комментарий менеджера — это лог действий. Каждая запись часто начинается с даты (например, "05.08.2025 - ..."). Самая СВЕЖАЯ и актуальная информация всегда находится В САМОМ КОНЦЕ текста. Игнорируй старые записи, если они противоречат последней!
2. КУПИЛИ У ДРУГИХ: Если в последней записи упоминается "выбрали поставщиков", "купили в другом месте", "отдали счет другим", "уже купили", "взяли у других" -> выбери "cancel-other" (Купили в другом месте). Это ПРИОРИТЕТНАЯ причина отмены.
3. РАБОЧИЕ СТАТУСЫ: Если в последней записи указано, что процесс продолжается (ждем ТЗ, считаем, уточняем габариты, звоним, договариваемся), выбери соответствующий рабочий статус (например, "v-proscete", "na-soglasovanii", "raschet", "zapros-kontaktov").
4. ПРИЧИНЫ ОТМЕНЫ (если процесс завершен):
   - Цена/дорого/нет денег -> "otmenili-zakupku-v-svyazi-s-nedostatochnym-finansirovaniem"
   - Нет товара/не производим -> "net-takikh-pozitsii"
   - Долго/не успеем в срок -> "no-product"
   - Не отвечает/недоступен (последние записи) -> "zakazchik-ne-vykhodit-na-sviaz"
   - Просто передумал/нет причины -> "otmenen-propala-neobkhodimost"
5. БЕЗОПАСНОСТЬ: Если ты не уверен (confidence < 0.7) или комментарий пустой/непонятный -> используй "otmenen-propala-neobkhodimost".

Верни ТОЛЬКО JSON (без markdown):
{
  "target_status": "код_статуса",
  "confidence": 0.0-1.0,
  "reasoning": "Краткое объяснение на русском (1-2 предложения), почему выбран именно этот статус на основе ПОСЛЕДНЕЙ информации в комментарии."
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
