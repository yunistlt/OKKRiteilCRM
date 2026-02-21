import { NextResponse } from 'next/server';
import { getOpenAIClient } from '@/utils/openai';
import { runInsightAnalysis } from '@/lib/insight-agent';
import { getStoredPriorities } from '@/lib/prioritization';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { message, history = [] } = body;

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const openai = getOpenAIClient();

        // 1. Analyze intent with OpenAI
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Вы — AI-ассистент в Центре Управления (Office). Ваш собеседник — руководитель (РОП).
Ваша задача — понять текстовую команду руководителя и вызвать соответствующую функцию для её выполнения.
Если пользователь просит проанализировать конкретный заказ, вызовите analyze_order.
Если он просит проанализировать заказы по какому-то признаку (например, "в работе", "критичные", "новые"), вызовите analyze_status.
Вы также помните контекст предыдущей беседы. Вы можете просто отвечать на вопросы пользователя, если он спрашивает о заказах из текущей сессии (например: "какие рекомендации у последнего?", "кто там ЛПР?").
Разрешается отвечать текстом без вызова функций, если из контекста понятно, что нужно сказать (например, при ответе на обычный вопрос).`
                },
                ...history.map((msg: any) => ({
                    role: msg.role === 'agent' ? 'assistant' : 'user', // Map our UI role to OpenAI role
                    content: msg.text || msg.content || ''
                })),
                {
                    role: 'user',
                    content: message
                }
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'analyze_order',
                        description: 'Запустить глубокий анализ конкретного заказа',
                        parameters: {
                            type: 'object',
                            properties: {
                                order_id: {
                                    type: 'number',
                                    description: 'Номер заказа (число)'
                                }
                            },
                            required: ['order_id']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'analyze_status',
                        description: 'Проанализировать или найти заказы с определенным статусом или приоритетом',
                        parameters: {
                            type: 'object',
                            properties: {
                                status_keyword: {
                                    type: 'string',
                                    description: 'Ключевое слово статуса заказа или приоритета (например, "work", "красные", "согласование", "novyi")'
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Максимальное количество заказов для анализа',
                                    default: 5
                                }
                            },
                            required: ['status_keyword']
                        }
                    }
                }
            ],
            tool_choice: 'auto',
        });

        const responseMessage = completion.choices[0].message;

        // Если ИИ решил вызвать функцию
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0] as any;
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);

            if (functionName === 'analyze_order') {
                const orderId = args.order_id;
                try {
                    const insights = await runInsightAnalysis(orderId);

                    if (!insights) {
                        return NextResponse.json({
                            success: true,
                            agent: 'Анна',
                            text: `Я попыталась проанализировать заказ #${orderId}, но не смогла найти данные или анализ не удался.`,
                            action: { type: 'analyze_order', orderId, result: null }
                        });
                    }

                    // Формируем текстовый ответ
                    const replyText = `**Заказ #${orderId}** проанализирован.\n` +
                        `ЛПР: ${insights.lpr?.name || 'Неизвестен'} (${insights.lpr?.role || ''})\n` +
                        `Резюме: ${insights.summary}\n` +
                        (insights.recommendations ? `\nРекомендации:\n- ${insights.recommendations.join('\n- ')}` : '');

                    return NextResponse.json({
                        success: true,
                        agent: 'Анна',
                        text: replyText,
                        action: { type: 'analyze_order', orderId, result: insights }
                    });

                } catch (e: any) {
                    return NextResponse.json({
                        success: true,
                        agent: 'Система',
                        text: `Произошла ошибка при анализе заказа: ${e.message}`,
                        error: e.message
                    });
                }
            } else if (functionName === 'analyze_status') {
                const keyword = args.status_keyword.toLowerCase();
                const limit = args.limit || 5;

                const allPriorities = await getStoredPriorities(500);

                // Простая фильтрация (по level, summary, status и reasons)
                const filtered = allPriorities.filter(o =>
                    o.level === keyword ||
                    o.summary?.toLowerCase().includes(keyword) ||
                    (o as any).status?.toLowerCase().includes(keyword) ||
                    (keyword === 'красные' && o.level === 'red') ||
                    (keyword === 'желтые' && o.level === 'yellow') ||
                    (keyword === 'зеленые' && o.level === 'green')
                ).slice(0, limit);

                if (filtered.length === 0) {
                    return NextResponse.json({
                        success: true,
                        agent: 'Игорь',
                        text: `Я проверил очередь, но не нашел актуальных заказов по запросу "${keyword}".`,
                        action: { type: 'analyze_status', keyword, count: 0 }
                    });
                }

                let replyText = `Найдено ${filtered.length} заказов по запросу "${keyword}":\n\n`;
                filtered.forEach(o => {
                    replyText += `- **#${o.orderNumber}** (${o.level}, ${o.managerName}): ${o.totalSum} руб.\n`;
                    if (o.recommendedAction) {
                        replyText += `  💡 ${o.recommendedAction}\n`;
                    }
                });

                return NextResponse.json({
                    success: true,
                    agent: 'Игорь',
                    text: replyText,
                    action: { type: 'analyze_status', keyword, result: filtered }
                });
            }
        }

        // Если функция не вызвана, возвращаем прямой ответ
        return NextResponse.json({
            success: true,
            agent: 'Ассистент',
            text: responseMessage.content || 'Я не совсем поняла команду. Попробуйте уточнить (например, "проанализируй заказ 12345").'
        });

    } catch (e: any) {
        console.error('[AI Chat API] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
