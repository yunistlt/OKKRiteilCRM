// Псевдокод для обновления воркера аналитики (order-insight-refresh / call-semantic-rules)
// Добавить извлечение customer_questions_asked и customer_pains_voiced

import { callOpenAI } from '../lib/your-openai-module'; // TODO: заменить на реальный модуль
import { updateOrderMetrics } from '../lib/your-db-module'; // TODO: заменить на реальный модуль

export async function processTranscript(transcript: string, orderId: string) {
  // 1. Вызов OpenAI для извлечения вопросов и болей
  const aiResult = await callOpenAI({
    model: 'gpt-4o-mini',
    prompt: `Извлеки из текста вопросы и боли/возражения клиентов. Верни JSON вида: {\"customer_questions_asked\":[], \"customer_pains_voiced\":[]}`,
    transcript,
  });

  // 2. Сохранить новые метрики в order_metrics или full_order_context
  await updateOrderMetrics(orderId, {
    customer_questions_asked: aiResult.customer_questions_asked,
    customer_pains_voiced: aiResult.customer_pains_voiced,
  });
}
