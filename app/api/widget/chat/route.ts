import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient } from '@/utils/openai';
import { createLeadInCrm } from '@/lib/retailcrm-leads';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT_TEMPLATE = `
Ты — умный помощник компании ЗМК (Завод Металлических Конструкций). 
Твоя цель: проконсультировать клиента по услугам (заборы, ворота, металлоконструкции) и продукции, используя базу знаний.
Твоя главная задача: ненавязчиво получить контактные данные клиента (имя, номер телефона, email или ник в Telegram), чтобы инженер мог сделать точный расчет сметы.

Контекст посетителя:
- Домен: {{domain}}
- Интересовался товарами: {{cartItems}}
- Просмотренные страницы: {{visitedPages}}

Релевантные знания из базы:
{{knowledgeContext}}

Правила общения:
1. Будь вежливым и профессиональным.
2. Используй информацию о просмотренных товарах, чтобы сделать общение персональным.
3. Если клиент спрашивает цену, объясни, что она зависит от параметров (длина, высота, тип монтажа) и предложи расчет сметы инженером.
4. Если клиент оставил любые контактные данные (телефон, почту, телеграм), используй инструмент create_lead_in_crm, чтобы передать данные в CRM.
5. Не вызывай функцию создания лида, если клиент не оставил контактов. Просто продолжай консультировать.
`;

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { visitorId, message, visitorData, type } = body;

        if (!visitorId) {
            return NextResponse.json({ error: 'Missing visitorId' }, { status: 400 });
        }

        // 1. Get or Create Session
        let { data: session, error: sessionError } = await supabase
            .from('widget_sessions')
            .select('*')
            .eq('visitor_id', visitorId)
            .maybeSingle();

        if (sessionError) throw sessionError;

        const city = req.headers.get('x-vercel-ip-city');

        if (!session) {
            const { data: newSession, error: createError } = await supabase
                .from('widget_sessions')
                .insert({
                    visitor_id: visitorId,
                    domain: visitorData?.domain,
                    utm_source: visitorData?.utm?.source,
                    utm_medium: visitorData?.utm?.medium,
                    utm_campaign: visitorData?.utm?.campaign,
                    utm_content: visitorData?.utm?.content,
                    utm_term: visitorData?.utm?.term,
                    referrer: visitorData?.referrer,
                    landing_page: visitorData?.landingPage,
                    user_agent: visitorData?.userAgent,
                    geo_city: city
                })
                .select('*')
                .single();
            
            if (createError) throw createError;
            session = newSession;
        } else {
            // Update session if needed (e.g. city)
            if (city && !session.geo_city) {
                await supabase.from('widget_sessions').update({ geo_city: city }).eq('id', session.id);
            }
        }

        const sessionId = session!.id;

        // 2. Handle 'init' event (Magic happens here)
        if (type === 'init') {
            // Log the page view if provided
            if (visitorData?.visitedPages?.length > 0) {
                const lastPage = visitorData.visitedPages[visitorData.visitedPages.length - 1];
                await supabase.from('widget_events').insert({
                    session_id: sessionId,
                    event_type: 'page_view',
                    url: lastPage.url,
                    page_title: lastPage.title
                });
            }

            // Check for returning visitor magic
            const { count: msgCount } = await supabase
                .from('widget_messages')
                .select('*', { count: 'exact', head: true })
                .eq('session_id', sessionId);

            // If user has been here before but hasn't chatted much, or has items in cart
            if (visitorData?.cartItems?.length > 0 && (msgCount || 0) < 2) {
                return NextResponse.json({ 
                    success: true, 
                    magicGreeting: `С возвращением! Вижу, вы интересовались товаром "${visitorData.cartItems[0]}". Нужна помощь с расчетом или консультация инженера?` 
                });
            }

            return NextResponse.json({ success: true });
        }

        // 3. Log Message from User (for regular chat messages)
        if (!message) return NextResponse.json({ error: 'Message is required for chat' }, { status: 400 });
        
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'user',
            content: message
        });

        // 3. Log Event (optional)
        if (visitorData?.visitedPages?.length > 0) {
            const lastPage = visitorData.visitedPages[visitorData.visitedPages.length - 1];
            await supabase.from('widget_events').insert({
                session_id: sessionId,
                event_type: 'page_view',
                url: lastPage.url,
                page_title: lastPage.title
            });
        }

        // 4. Get Knowledge Base Context (RAG)
        const openai = getOpenAIClient();
        
        // Generate embedding for the message
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: message,
        });
        const embedding = embeddingResponse.data[0].embedding;

        // Search Knowledge Base
        const { data: knowledge, error: searchError } = await supabase.rpc('match_okk_consultant_knowledge', {
            query_embedding: embedding,
            match_threshold: 0.5,
            match_count: 5
        });

        const knowledgeContext = knowledge?.map((k: any) => `[${k.title}]: ${k.content}`).join('\n\n') || 'База знаний пуста или ничего не найдено.';

        // 5. Get History
        const { data: history } = await supabase
            .from('widget_messages')
            .select('role, content')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true })
            .limit(10);

        const chatHistory = history?.map(h => ({
            role: h.role as 'user' | 'assistant' | 'system',
            content: h.content
        })) || [];

        // 6. Build System Prompt
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE
            .replace('{{domain}}', visitorData?.domain || 'неизвестно')
            .replace('{{cartItems}}', visitorData?.cartItems?.join(', ') || 'нет товаров')
            .replace('{{visitedPages}}', visitorData?.visitedPages?.slice(-3).map((p: any) => p.title).join(', ') || 'неизвестно')
            .replace('{{knowledgeContext}}', knowledgeContext);

        // 7. OpenAI Chat Completion
        const tools: any[] = [{
            type: 'function',
            function: {
                name: 'create_lead_in_crm',
                description: 'Создает лида в RetailCRM, когда клиент оставил любые контактные данные',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Имя клиента' },
                        phone: { type: 'string', description: 'Номер телефона клиента' },
                        email: { type: 'string', description: 'Email клиента' },
                        telegram: { type: 'string', description: 'Ник в Telegram' },
                        query_summary: { type: 'string', description: 'Краткая суть запроса клиента' }
                    },
                    required: ['query_summary']
                }
            }
        }];

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                ...chatHistory
            ],
            tools,
            tool_choice: 'auto',
            temperature: 0.7
        });

        const assistantMessage = response.choices[0].message;

        // 8. Handle Tool Calls
        if (assistantMessage.tool_calls) {
            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.function.name === 'create_lead_in_crm') {
                    const args = JSON.parse(toolCall.function.arguments);
                    try {
                        // Load full session for context
                        const { data: sessionData } = await supabase
                            .from('widget_sessions')
                            .select('*')
                            .eq('id', sessionId)
                            .single();

                        await createLeadInCrm({
                            ...args,
                            domain: visitorData?.domain,
                            utm: visitorData?.utm,
                            items: visitorData?.cartItems,
                            city: sessionData?.geo_city,
                            history: chatHistory,
                            visitedPages: visitorData?.visitedPages
                        });
                        
                        // Add a system message to history about success
                        await supabase.from('widget_messages').insert({
                            session_id: sessionId,
                            role: 'system',
                            content: `Лид успешно создан для ${args.name} (${args.phone})`
                        });

                        // Optionally follow up with AI to confirm to user
                        const followUp = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                ...chatHistory,
                                assistantMessage,
                                {
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ success: true })
                                }
                            ]
                        });
                        
                        const followUpText = followUp.choices[0].message.content || 'Спасибо! Мы получили ваши данные и скоро свяжемся.';
                        
                        await supabase.from('widget_messages').insert({
                            session_id: sessionId,
                            role: 'assistant',
                            content: followUpText
                        });

                        return NextResponse.json({ reply: followUpText });
                    } catch (crmError) {
                        console.error('CRM Integration Error:', crmError);
                        return NextResponse.json({ reply: 'Извините, произошла ошибка при сохранении ваших данных. Пожалуйста, попробуйте позже или позвоните нам.' });
                    }
                }
            }
        }

        // 9. Save Assistant Response and Return
        const replyText = assistantMessage.content || 'Я здесь, чем могу помочь?';
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'assistant',
            content: replyText
        });

        return NextResponse.json({ reply: replyText });

    } catch (error: any) {
        console.error('Widget API Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
