import { NextResponse } from 'next/server';
import { getOpenAIClient } from '@/utils/openai';
import { runInsightAnalysis } from '@/lib/insight-agent';
import { getStoredPriorities } from '@/lib/prioritization';
import { supabase } from '@/utils/supabase';

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
Ваша задача — понять текстовую команду руководителя и выполнить её, используя инструменты с РЕАЛЬНЫМИ данными из системы. Никогда не придумывайте данные — всегда вызывайте соответствующий инструмент.

Состав нашей ИИ-Команды:
1. АННА (Вы): Глубокий разбор заказов, поиск ЛПР, детекция "Зомби-сделок", рекомендации по дожиму.
2. МАКСИМ (Аудитор): Контроль качества, проверки звонков и регламентов, маршрутизация отмененных заказов.
3. ИГОРЬ (Диспетчер): Контроль SLA, статусов, поиск заказов в очереди.
4. СЕМЁН (Архивариус): Сбор данных из RetailCRM, информация по заказам, история событий.

ПРАВИЛА ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
- Если просят "проанализировать заказ" (глубокий разбор, ЛПР, рекомендации) → вызовите analyze_order (Анна).
- Если просят "проверить/посмотреть звонки/транскрипции" по заказу (Максим) → вызовите check_order_calls.
- Если просят "инфо/данные/статус/базу" по заказу (Семён/Игорь) → вызовите get_order_info.
- Если просят "решение по роутингу/что Максим решил/последнее решение" → вызовите get_routing_decision.
- Если просят "найти заказы по статусу/приоритету" → вызовите analyze_status (Игорь).
- Если вопрос текстовый без запроса данных → вызовите respond_as_agent.

КРИТИЧЕСКИ ВАЖНО: Никогда не отвечайте от имени Максима, Семёна или Игоря просто текстом без вызова инструмента, если вопрос касается конкретных данных (заказов, звонков, статусов). Всегда вызывайте нужный инструмент.`
                },
                ...history.map((msg: any) => ({
                    role: msg.role === 'agent' ? 'assistant' : 'user',
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
                        description: 'Запустить глубокий анализ конкретного заказа (Анна): ЛПР, бюджет, рекомендации по дожиму',
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
                        name: 'check_order_calls',
                        description: 'Максим: проверить звонки и транскрипции по заказу. Используется когда просят проверить звонки, прослушать переговоры, посмотреть транскрипцию.',
                        parameters: {
                            type: 'object',
                            properties: {
                                order_id: {
                                    type: 'number',
                                    description: 'Номер заказа'
                                }
                            },
                            required: ['order_id']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'get_order_info',
                        description: 'Семён/Игорь: получить базовую информацию по заказу — статус, менеджер, сумма, дата, краткое резюме Анны.',
                        parameters: {
                            type: 'object',
                            properties: {
                                order_id: {
                                    type: 'number',
                                    description: 'Номер заказа'
                                }
                            },
                            required: ['order_id']
                        }
                    }
                },
                {
                    type: 'function',
                    function: {
                        name: 'get_routing_decision',
                        description: 'Максим: получить последнее решение по автоматической маршрутизации заказа (ai_routing_logs). Используется когда спрашивают о решении Максима, о роутинге, о причине смены статуса.',
                        parameters: {
                            type: 'object',
                            properties: {
                                order_id: {
                                    type: 'number',
                                    description: 'Номер заказа'
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
                        description: 'Игорь: проанализировать или найти заказы с определенным статусом или приоритетом',
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
                        description: 'Ответить пользователю голосом выбранного ИИ-сотрудника. Использовать ТОЛЬКО для общих вопросов БЕЗ запроса конкретных данных.',
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

            // ─── РЕАЛЬНЫЙ ЗАПРОС: Проверка звонков (Максим) ───
            if (functionName === 'check_order_calls') {
                const orderId = args.order_id;
                try {
                    const { data: callMatches } = await supabase
                        .from('call_order_matches')
                        .select('telphin_call_id')
                        .eq('retailcrm_order_id', orderId);

                    const callIds = (callMatches || []).map((m: any) => m.telphin_call_id);

                    if (callIds.length === 0) {
                        return NextResponse.json({
                            success: true,
                            agent: 'Максим',
                            text: `🤓 Максим проверил базу по заказу #${orderId}.\n\n**Результат:** Звонков не найдено — ни одного совпадения в системе по этому заказу. Возможно, звонки были до создания заказа или не прошли матчинг.`
                        });
                    }

                    const { data: calls, error: callsError } = await supabase
                        .from('raw_telphin_calls')
                        .select('*')
                        .in('telphin_call_id', callIds)
                        .order('started_at', { ascending: false });

                    if (callsError) {
                        console.error('[check_order_calls] Error fetching calls:', callsError);
                        return NextResponse.json({
                            success: true,
                            agent: 'Максим',
                            text: `🤓 Максим проверил базу, но произошла ошибка при получении данных звонков: ${callsError.message}`
                        });
                    }

                    if (!calls || calls.length === 0) {
                        return NextResponse.json({
                            success: true,
                            agent: 'Максим',
                            text: `🤓 Максим проверил базу по заказу #${orderId}.\n\n**Результат:** Совпадений найдено (${callIds.length}), но записи звонков не найдены в базе.`
                        });
                    }

                    let replyText = `🤓 **Максим — аудит звонков по заказу #${orderId}**\n\nНайдено звонков: **${calls.length}**\n\n`;

                    calls.forEach((call: any, idx: number) => {
                        const date = new Date(call.started_at).toLocaleString('ru-RU', { timeZone: 'UTC' });
                        const dirLabel = call.direction === 'incoming' ? '📲 Входящий' : '📞 Исходящий';
                        const dur = call.duration_sec ? `${Math.floor(call.duration_sec / 60)}м ${call.duration_sec % 60}с` : 'н/д';
                        const hasTranscript = !!call.transcript;
                        const isAM = call.is_answering_machine;
                        const status = call.transcription_status || 'н/д';

                        replyText += `**${idx + 1}. ${dirLabel} — ${date}**\n`;
                        replyText += `⏱ Длительность: ${dur}\n`;
                        replyText += `📝 Транскрипт: ${hasTranscript ? 'есть' : 'отсутствует'} (статус: ${status})\n`;
                        if (isAM) replyText += `🤖 Автоответчик: да\n`;
                        if (call.recording_url) replyText += `🎧 [Прослушать запись](${call.recording_url})\n`;

                        if (hasTranscript && !isAM) {
                            const preview = call.transcript.substring(0, 200).trim();
                            replyText += `\n💬 Начало разговора:\n_«${preview}${call.transcript.length > 200 ? '...' : ''}»_\n`;
                        }
                        replyText += '\n';
                    });

                    return NextResponse.json({
                        success: true,
                        agent: 'Максим',
                        text: replyText
                    });

                } catch (e: any) {
                    return NextResponse.json({
                        success: true,
                        agent: 'Система',
                        text: `Ошибка при проверке звонков: ${e.message}`
                    });
                }
            }

            // ─── РЕАЛЬНЫЙ ЗАПРОС: Инфо по заказу (Семён) ───
            if (functionName === 'get_order_info') {
                const orderId = args.order_id;
                try {
                    const { data: order } = await supabase
                        .from('orders')
                        .select('*, managers(first_name, last_name)')
                        .eq('order_id', orderId)
                        .single();

                    if (!order) {
                        return NextResponse.json({
                            success: true,
                            agent: 'Семен',
                            text: `📁 Семён поискал в архиве заказ #${orderId}... Не найден. Возможно, ещё не синхронизирован из RetailCRM.`
                        });
                    }

                    const { data: metrics } = await supabase
                        .from('order_metrics')
                        .select('insights')
                        .eq('retailcrm_order_id', orderId)
                        .maybeSingle();

                    const p = order.raw_payload || {};
                    const managerName = order.managers
                        ? `${order.managers.first_name || ''} ${order.managers.last_name || ''}`.trim()
                        : 'Не определён';
                    const totalSum = p.summ ? `${Number(p.summ).toLocaleString('ru-RU')} ₽` : 'Не указана';
                    const status = p.status?.name || order.status || 'Неизвестен';
                    const createdAt = p.createdAt ? new Date(p.createdAt).toLocaleString('ru-RU') : 'Не указана';
                    const summary = metrics?.insights?.summary || 'Анна ещё не анализировала заказ.';

                    let replyText = `📁 **Семён — досье по заказу #${orderId}**\n\n`;
                    replyText += `📌 Статус: **${status}**\n`;
                    replyText += `👤 Менеджер: **${managerName}**\n`;
                    replyText += `💰 Сумма: **${totalSum}**\n`;
                    replyText += `📅 Создан: ${createdAt}\n`;
                    if (p.firstName || p.lastName) {
                        replyText += `🤝 Клиент: ${p.firstName || ''} ${p.lastName || ''} ${p.phone ? `(${p.phone})` : ''}\n`;
                    }
                    if (p.company) replyText += `🏢 Компания: ${p.company.name || p.company}\n`;
                    replyText += `\n📊 Анна говорит: _«${summary}»_`;

                    return NextResponse.json({
                        success: true,
                        agent: 'Семен',
                        text: replyText
                    });

                } catch (e: any) {
                    return NextResponse.json({
                        success: true,
                        agent: 'Система',
                        text: `Ошибка при получении данных по заказу: ${e.message}`
                    });
                }
            }

            // ─── РЕАЛЬНЫЙ ЗАПРОС: Решение по роутингу (Максим) ───
            if (functionName === 'get_routing_decision') {
                const orderId = args.order_id;
                try {
                    const { data: logs } = await supabase
                        .from('ai_routing_logs')
                        .select('*')
                        .eq('order_id', orderId)
                        .order('created_at', { ascending: false })
                        .limit(3);

                    if (!logs || logs.length === 0) {
                        return NextResponse.json({
                            success: true,
                            agent: 'Максим',
                            text: `🤓 Максим проверил журнал роутинга по заказу #${orderId}.\n\nСоответствующих записей нет — автоматическая маршрутизация для этого заказа не запускалась.`
                        });
                    }

                    let replyText = `🤓 **Максим — решения по роутингу заказа #${orderId}**\n\n`;

                    logs.forEach((log: any, idx: number) => {
                        const date = log.created_at ? new Date(log.created_at).toLocaleString('ru-RU') : 'н/д';
                        const confidence = log.confidence ? `${(log.confidence * 100).toFixed(0)}%` : 'н/д';
                        const applied = log.was_applied ? '✅ Применено' : '🔍 Тест (не применено)';
                        replyText += `**${idx + 1}. ${date}** — ${applied}\n`;
                        replyText += `📊 Статус: **${log.from_status}** → **${log.to_status}** (confidence: ${confidence})\n`;
                        if (log.ai_reasoning) {
                            replyText += `💬 Обоснование: _${log.ai_reasoning}_\n`;
                        }
                        replyText += '\n';
                    });

                    return NextResponse.json({
                        success: true,
                        agent: 'Максим',
                        text: replyText
                    });

                } catch (e: any) {
                    return NextResponse.json({
                        success: true,
                        agent: 'Система',
                        text: `Ошибка при получении решений по роутингу: ${e.message}`
                    });
                }
            }

            // ─── ГЛУБОКИЙ АНАЛИЗ (Анна) ───
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
            }

            // ─── АНАЛИЗ СТАТУСА (Игорь) ───
            if (functionName === 'analyze_status') {
                const keyword = args.status_keyword.toLowerCase();
                const limit = args.limit || 5;

                const allPriorities = await getStoredPriorities(500);

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

            // ─── ТЕКСТОВЫЙ ОТВЕТ (respond_as_agent) ───
            if (functionName === 'respond_as_agent') {
                return NextResponse.json({
                    success: true,
                    agent: args.agent_name || 'Анна',
                    text: args.reply_text || 'Ошибка генерации ответа'
                });
            }
        }

        // Fallback
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
