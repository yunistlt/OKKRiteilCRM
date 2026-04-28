import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient } from '@/utils/openai';
import { createLeadInCrm } from '@/lib/retailcrm-leads';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

const SYSTEM_PROMPT_TEMPLATE = `
Ты — Елена, эксперт-продуктолог компании ЗМК (Завод Металлических Конструкций). 
Твоя роль: Быть самым компетентным помощником на сайте. Ты досконально знаешь весь ассортимент продукции: от простых стеллажей до специализированных шкафов ЛВЖ.

Твоя цель: Проконсультировать клиента по техническим характеристикам, помочь с выбором и ненавязчиво получить контактные данные (имя, телефон, email или ник в Telegram), чтобы инженер мог сделать точный расчет сметы.

Контекст посетителя:
- Домен: {{domain}}
- Интересовался товарами: {{cartItems}}
- Просмотренные страницы: {{visitedPages}}

Релевантные знания из базы:
{{knowledgeContext}}

Твои принципы общения:
1. Представляйся как Елена, продуктолог ЗМК.
2. Говори профессионально, но доступно (H2H-стиль).
3. Используй данные о просмотренных товарах, чтобы начать диалог персонально.
4. Если клиент оставил контакты, обязательно используй инструмент create_lead_in_crm.
5. Если данных в базе недостаточно, предложи консультацию инженера (для этого тоже нужны контакты).
`;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const visitorId = searchParams.get('visitorId');
    const after = searchParams.get('after');

    if (!visitorId) return NextResponse.json({ error: 'Missing visitorId' }, { status: 400, headers: CORS_HEADERS });

    const { data: session } = await supabase.from('widget_sessions').select('id').eq('visitor_id', visitorId).single();
    if (!session) return NextResponse.json({ newMessages: [] }, { headers: CORS_HEADERS });

    let query = supabase
        .from('widget_messages')
        .select('*')
        .eq('session_id', session.id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true });
    
    if (after) {
        query = query.gt('created_at', after);
    }

    const { data: messages } = await query;
    return NextResponse.json({ newMessages: messages || [] }, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { visitorId, message, visitorData, type } = body;

        if (!visitorId) {
            return NextResponse.json({ error: 'Missing visitorId' }, { status: 400, headers: CORS_HEADERS });
        }

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
        }

        const sessionId = session!.id;

        if (type === 'init') {
            if (visitorData?.visitedPages?.length > 0) {
                const lastPage = visitorData.visitedPages[visitorData.visitedPages.length - 1];
                await supabase.from('widget_events').insert({
                    session_id: sessionId,
                    event_type: 'page_view',
                    url: lastPage.url,
                    page_title: lastPage.title
                });
            }

            if (session?.is_human_takeover) {
                return NextResponse.json({ success: true, isHumanTakeover: true }, { headers: CORS_HEADERS });
            }

            const { count: msgCount } = await supabase
                .from('widget_messages')
                .select('*', { count: 'exact', head: true })
                .eq('session_id', sessionId);

            if (visitorData?.cartItems?.length > 0 && (msgCount || 0) < 2) {
                return NextResponse.json({ 
                    success: true, 
                    magicGreeting: `Здравствуйте! Я Елена, продуктолог ЗМК. Вижу, вы интересовались "${visitorData.cartItems[0]}". Подсказать вам технические детали или помочь с расчетом?` 
                }, { headers: CORS_HEADERS });
            }

            return NextResponse.json({ 
                success: true,
                magicGreeting: "Здравствуйте! Я Елена, продуктолог ЗМК. Если у вас возникнут вопросы по нашей продукции или техническим характеристикам — я с радостью отвечу!"
            }, { headers: CORS_HEADERS });
        }

        if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400, headers: CORS_HEADERS });
        
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'user',
            content: message
        });

        if (session?.is_human_takeover) {
            return NextResponse.json({ reply: null, isHumanTakeover: true }, { headers: CORS_HEADERS });
        }

        const openai = getOpenAIClient();
        const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: message,
        });
        const embedding = embeddingRes.data[0].embedding;

        const { data: knowledge } = await supabase.rpc('match_okk_consultant_knowledge', {
            query_embedding: embedding,
            match_threshold: 0.5,
            match_count: 5
        });

        const knowledgeContext = knowledge?.map((k: any) => `[${k.title}]: ${k.content}`).join('\n\n') || '';

        const { data: history } = await supabase
            .from('widget_messages')
            .select('role, content')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true })
            .limit(10);

        const chatHistory = history?.map((h: any) => ({
            role: h.role,
            content: h.content
        })) || [];

        const systemPrompt = SYSTEM_PROMPT_TEMPLATE
            .replace('{{domain}}', visitorData?.domain || '')
            .replace('{{cartItems}}', visitorData?.cartItems?.join(', ') || '')
            .replace('{{visitedPages}}', visitorData?.visitedPages?.slice(-3).map((p: any) => p.title).join(', ') || '')
            .replace('{{knowledgeContext}}', knowledgeContext);

        const tools: any[] = [{
            type: 'function',
            function: {
                name: 'create_lead_in_crm',
                description: 'Создает лида в RetailCRM',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        phone: { type: 'string' },
                        email: { type: 'string' },
                        telegram: { type: 'string' },
                        query_summary: { type: 'string' }
                    },
                    required: ['query_summary']
                }
            }
        }];

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, ...chatHistory],
            tools,
            tool_choice: 'auto'
        });

        const assistantMessage = response.choices[0].message;

        if (assistantMessage.tool_calls) {
            const toolCall = (assistantMessage.tool_calls as any)[0];
            if (toolCall.function.name === 'create_lead_in_crm') {
                const args = JSON.parse(toolCall.function.arguments);
                
                // CRITICAL FIX: Safe execution of CRM creation
                try {
                    await createLeadInCrm({
                        ...args,
                        domain: visitorData?.domain,
                        utm: visitorData?.utm,
                        items: visitorData?.cartItems,
                        city: session?.geo_city,
                        history: chatHistory,
                        visitedPages: visitorData?.visitedPages
                    });
                    
                    await supabase.from('widget_messages').insert({
                        session_id: sessionId, role: 'system', content: `Лид успешно отправлен в CRM: ${args.phone || args.telegram || args.email}`
                    });
                } catch (crmError) {
                    console.error('CRM Error (Safe Catch):', crmError);
                    await supabase.from('widget_messages').insert({
                        session_id: sessionId, role: 'system', content: `Ошибка отправки в CRM, контакт сохранен в БД: ${args.phone || args.telegram || args.email}`
                    });
                }

                const followUp = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...chatHistory,
                        assistantMessage,
                        { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ success: true }) }
                    ]
                });
                
                const reply = followUp.choices[0].message.content || 'Спасибо! Я передала ваши контакты инженеру, он свяжется с вами в ближайшее время.';
                await supabase.from('widget_messages').insert({ session_id: sessionId, role: 'assistant', content: reply });
                return NextResponse.json({ reply }, { headers: CORS_HEADERS });
            }
        }

        const replyText = assistantMessage.content || 'Чем могу помочь?';
        await supabase.from('widget_messages').insert({ session_id: sessionId, role: 'assistant', content: replyText });
        return NextResponse.json({ reply: replyText }, { headers: CORS_HEADERS });

    } catch (error: any) {
        console.error('Widget API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }
}
