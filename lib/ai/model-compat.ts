/**
 * Совместимость с новыми моделями OpenAI.
 *
 * Семейства gpt-5* и o* ведут себя иначе: вместо `max_tokens` требуют
 * `max_completion_tokens` и не принимают температуру, отличную от своей. Если послать
 * им старый набор параметров, запрос отвергается с 400 — и агент молча перестаёт
 * отвечать. Поэтому параметры собираются здесь, в одном месте, а не переписываются в
 * каждом агенте заново.
 *
 * Проверка по имени, а не по списку: список пришлось бы дописывать к каждому релизу
 * модели, а забытая модель ломается не мягко.
 */
export function isReasoningModel(model: string): boolean {
    return /^(gpt-5|o[134])/i.test(String(model || '').trim());
}

/**
 * Параметры генерации под конкретную модель.
 *
 * @param reasoningEffort насколько глубоко рассуждать. 'none' — отвечать сразу, так
 * ведут себя обычные модели; для разбора и советов имеет смысл поднять.
 */
export function modelTuning(params: {
    model: string;
    maxTokens: number;
    temperature?: number;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}): Record<string, unknown> {
    if (isReasoningModel(params.model)) {
        return {
            max_completion_tokens: params.maxTokens,
            reasoning_effort: params.reasoningEffort ?? 'none',
        };
    }

    return {
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.3,
    };
}
