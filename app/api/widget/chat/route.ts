import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient } from '@/utils/openai';
import { createLeadInCrm } from '@/lib/retailcrm-leads';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// External Supabase for LVZ Knowledge
const lvzSupabase = process.env.LVZ_SUPABASE_URL && process.env.LVZ_SUPABASE_ANON_KEY
    ? createClient(process.env.LVZ_SUPABASE_URL, process.env.LVZ_SUPABASE_ANON_KEY)
    : null;

const ADJECTIVES = ['Мягкий', 'Быстрый', 'Смелый', 'Умный', 'Яркий', 'Тихий', 'Мудрый', 'Ловкий', 'Верный', 'Гордый'];
const COLORS = ['Малиновый', 'Синий', 'Оранжевый', 'Зеленый', 'Золотой', 'Серебряный', 'Изумрудный', 'Алый', 'Бирюзовый', 'Фиолетовый'];
const ANIMALS = ['Лев', 'Медведь', 'Лис', 'Орел', 'Тигр', 'Слон', 'Волк', 'Дельфин', 'Рысь', 'Пантера'];

function generateNickname() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const col = COLORS[Math.floor(Math.random() * COLORS.length)];
    const ani = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${adj} ${col} ${ani}`;
}

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

Релевантные знания из базы (включая тех. базу ЛВЖ):
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
                    geo_city: city,
                    interested_products: visitorData?.cartItems || [],
                    nickname: generateNickname()
                })
                .select('*')
                .single();
            
            if (createError) throw createError;
            session = newSession;
        }

        const sessionId = session!.id;

        if (visitorData?.cartItems?.length > 0) {
            await supabase
                .from('widget_sessions')
                .update({ interested_products: visitorData.cartItems })
                .eq('id', sessionId);
        }

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
                const greeting = `Здравствуйте! Я Елена, продуктолог ЗМК. Вижу, вы интересовались "${visitorData.cartItems[0]}". Подсказать вам технические детали или помочь с расчетом?`;
                await supabase.from('widget_messages').insert({
                    session_id: sessionId,
                    role: 'assistant',
                    content: greeting
                });
                return NextResponse.json({ 
                    success: true, 
                    magicGreeting: greeting 
                }, { headers: CORS_HEADERS });
            }

            const defaultGreeting = "Здравствуйте! Я Елена, продуктолог ЗМК. Если у вас возникнут вопросы по нашей продукции или техническим характеристикам — я с радостью отвечу!";
            await supabase.from('widget_messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: defaultGreeting
            });

            return NextResponse.json({ 
                success: true,
                magicGreeting: defaultGreeting
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

        // PARALLEL KNOWLEDGE SEARCH
        const searchPromises = [
            supabase.rpc('match_okk_consultant_knowledge', {
                query_embedding: embedding,
                match_threshold: 0.5,
                match_count: 5
            })
        ];

        if (lvzSupabase) {
            searchPromises.push(
                lvzSupabase.rpc('match_knowledge', {
                    query_embedding: embedding,
                    match_threshold: 0.5,
                    match_count: 5
                })
            );
        }

        const searchResults = await Promise.all(searchPromises);
        
        const localKnowledge = searchResults[0].data?.map((k: any) => `[ЗМК Общее]: ${k.content}`) || [];
        const lvzKnowledge = searchResults[1]?.data?.map((k: any) => `[ЗМК ЛВЖ Тех]: ${k.content_chunk || k.content}`) || [];
        
        const knowledgeContext = [...localKnowledge, ...lvzKnowledge].join('\n\n') || '';

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
                        session_id: sessionId, role: 'system', content: `Лид отправлен: ${args.phone || args.telegram}`
                    });
                } catch (e) {
                    await supabase.from('widget_messages').insert({
                        session_id: sessionId, role: 'system', content: `Ошибка CRM, контакт сохранен: ${args.phone || args.telegram}`
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
                const reply = followUp.choices[0].message.content || 'Спасибо! Мы получили ваши данные.';
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
