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

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const visitorId = searchParams.get('visitorId');
    const after = searchParams.get('after');

    if (!visitorId) return NextResponse.json({ error: 'Missing visitorId' }, { status: 400 });

    const { data: session } = await supabase.from('widget_sessions').select('id').eq('visitor_id', visitorId).single();
    if (!session) return NextResponse.json({ newMessages: [] });

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
    return NextResponse.json({ newMessages: messages || [] });
}

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
            if (city && !session.geo_city) {
                await supabase.from('widget_sessions').update({ geo_city: city }).eq('id', session.id);
            }
        }

        const sessionId = session!.id;

        // 2. Handle 'init' event
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
                return NextResponse.json({ success: true, isHumanTakeover: true });
            }

            const { count: msgCount } = await supabase
                .from('widget_messages')
                .select('*', { count: 'exact', head: true })
                .eq('session_id', sessionId);

            if (visitorData?.cartItems?.length > 0 && (msgCount || 0) < 2) {
                return NextResponse.json({ 
                    success: true, 
                    magicGreeting: `С возвращением! Вижу, вы интересовались товаром "${visitorData.cartItems[0]}". Нужна помощь с расчетом или консультация инженера?` 
                });
            }

            return NextResponse.json({ success: true });
        }

        // 3. Log Message from User
        if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'user',
            content: message
        });

        // 4. Human Takeover Check
        if (session?.is_human_takeover) {
            return NextResponse.json({ reply: null, isHumanTakeover: true });
        }

        // 5. RAG & OpenAI
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
                    session_id: sessionId, role: 'system', content: `Лид создан: ${args.phone || args.telegram || args.email}`
                });

                const followUp = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...chatHistory,
                        assistantMessage,
                        { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ success: true }) }
                    ]
                });
                
                const reply = followUp.choices[0].message.content || 'Спасибо! Мы получили ваши данные.';
                await supabase.from('widget_messages').insert({ session_id: sessionId, role: 'assistant', content: reply });
                return NextResponse.json({ reply });
            }
        }

        const replyText = assistantMessage.content || 'Чем могу помочь?';
        await supabase.from('widget_messages').insert({ session_id: sessionId, role: 'assistant', content: replyText });
        return NextResponse.json({ reply: replyText });

    } catch (error: any) {
        console.error('Widget API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
