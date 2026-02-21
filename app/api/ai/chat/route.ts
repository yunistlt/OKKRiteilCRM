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
                    content: `Вы — Анна, ведущий ИИ-аналитик Центра Управления (Office). Ваш собеседник — руководитель (РОП).
Ваша задача — понять текстовую команду руководителя. Если задача в вашей компетенции, вы выполняете её сами. Если она относится к зоне ответственности другого сотрудника команды, вы просите его ответить.

Состав нашей ИИ-Команды:
1. АННА (Вы): Глубокий разбор заказов, поиск ЛПР, детекция "Зомби-сделок", рекомендации по дожиму. (Вы анализируете конкретные заказы).
2. МАКСИМ (Аудитор): Контроль качества, проверки звонков и регламентов, маршрутизация отмененных заказов.
3. ИГОРЬ (Диспетчер): Контроль SLA, статусов, поиск заказов в очереди (например, "зеленые", "в работе").
4. СЕМЁН (Архивариус): Сбор данных из RetailCRM, логирование истории событий.

ПРАВИЛА ОТВЕТОВ:
- Если пользователь просит проанализировать конкретный заказ, вызовите инструмент analyze_order (выполняете вы).
- Если он просит проанализировать заказы по какому-то статусу или признаку, вызовите analyze_status (это делает Игорь).
- Если вопрос обычный текстовый (например "кто чем занят?", "Максим, как успехи?", "какие рекомендации у последнего заказа?"), НЕМЕДЛЕННО вызовите инструмент respond_as_agent.
- Вызывая respond_as_agent, выберите, кто именно отвечает. Если вопрос к вам (Анне) или общий — отвечайте от имени "Анна". Если вопрос к Игорю, Максиму или Семену, или напрямую касается их работы (например, "Семен, где база?"), сделайте так, чтобы ответили они (выберите их имя в agent_name).`
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
                },
                {
                    type: 'function',
                    function: {
                        name: 'respond_as_agent',
                        description: 'Ответить пользователю голосом выбранного ИИ-сотрудника.',
                        parameters: {
                            type: 'object',
                            properties: {
                                agent_name: {
                                    type: 'string',
                                    enum: ['Анна', 'Максим', 'Игорь', 'Семен', 'Система'],
                                    description: 'Имя сотрудника, который отвечает.'
                                },
                                reply_text: {
                                    type: 'string',
                                    description: 'Текст ответа от лица сотрудника.'
                                }
                            },
                            required: ['agent_name', 'reply_text']
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
            } else if (functionName === 'respond_as_agent') {
                return NextResponse.json({
                    success: true,
                    agent: args.agent_name || 'Анна',
                    text: args.reply_text || 'Ошибка генерации ответа'
                });
            }
        }

        // Если функция не вызвана (fallback)
        return NextResponse.json({
            success: true,
            agent: 'Анна',
            text: responseMessage.content || 'Похоже, я не поняла, к кому вы обращаетесь или что нужно сделать.'
        });

    } catch (e: any) {
        console.error('[AI Chat API] Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
