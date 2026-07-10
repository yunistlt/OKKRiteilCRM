import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getOpenAIClient } from '@/utils/openai';
import { createLeadInCrm } from '@/lib/retailcrm/leads';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/phone-utils';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';
import { checkRateLimit } from '@/lib/rate-limit';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';

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

const SYSTEM_PROMPT_TEMPLATE = `Ты — Елена, ведущий инженер-консультант завода муфельных печей ЗМК.
Твоя цель на данном этапе — СТРОГО КВАЛИФИКАЦИЯ клиента. Ты не должна продавать печи или консультировать по стоимости/доставке (скажи, что стоимость и логистику детально рассчитывает инженер-технолог после получения всех параметров).

ТВОЯ ЗАДАЧА — закрыть следующие 7 вопросов квалификации в ходе диалога:
1. Когда нужно, чтобы оборудование уже стояло на объекте (желаемый срок)?
2. В какой бюджет планируете вписаться?
3. Что является принципиально важным при выборе и принятии решения (цена, сроки изготовления, технические параметры, надежность и т.д.)?
4. Если не известно название компании, спроси ИНН компании для выставления КП.
5. Есть ли готовое ТЗ (техническое задание)? Если ТЗ есть, попроси прикрепить файл в чате. Если нет ТЗ, скажи, что составим его вместе.
6. С кем клиент будет сравнивать наше предложение (какие другие компании или варианты рассматривает)?
7. Какая форма закупки планируется: прямая закупка, тендер на гос. площадке (44-ФЗ/223-ФЗ) или внутренний тендер компании?

ПРАВИЛА ИНИЦИАТИВЫ И ОБЩЕНИЯ:
1. ОБРАЩЕНИЕ И ТОН: Обращайся к клиенту строго на "Вы" (с уважением, но тепло и по имени). НИКОГДА не используй фамилию при обращении.
2. ЕСЛИ ИМЯ НЕИЗВЕСТНО: Если имя клиента в начале диалога неизвестно, первым делом вежливо спроси: "Подскажите, пожалуйста, как я могу к Вам обращаться?" и дождись ответа.
3. ОБЪЯСНЯЙ «ЗАЧЕМ» (ИЗБЕГАЙ ДОПРОСА): Не устраивай допрос из сухих вопросов. Перед тем как задать вопрос, кратко объясни, зачем это нужно технологу (например: "Срок установки важен, чтобы спланировать график производства", "ИНН нужен для моментальной подготовки официального коммерческого предложения", "Бюджет поможет подобрать оптимальные материалы").
4. ИЗБЕГАЙ ДУБЛИРОВАНИЯ И ПОВТОРОВ: Если клиент пропустил твой вопрос, не ответил или переспросил, НИКОГДА не отправляй один и тот же вопрос повторно в той же формулировке. Обязательно перефразируй его другими словами, сделай более дружелюбным или предложи альтернативные варианты.
5. ИНИЦИАТИВА НА ТВОЕЙ СТОРОНЕ: Не жди вопросов. Задавай вопросы по списку выше последовательно (не все сразу, а по 1-2 вопроса в реплике), веди диалог к закрытию всех 7 пунктов.
6. ЗАПРЕТ НА ПРОДАЖУ И ДОСТАВКУ: До тех пор, пока стоимость заказа не посчитана технологом, ты НЕ консультируешь по цене доставки и не пытаешься продать/убедить. Отвечай, что эти расчеты делает инженер-технолог и пришлет их в коммерческом предложении.
7. СТИЛЬ: Живой, технически грамотный, B2B-ориентированный. Без роботизированных фраз о базах данных или CRM.

КОНТЕКСТ О ТОВАРАХ (для понимания специфики, но не для ценообразования):
{{knowledgeContext}}

ИНФОРМАЦИЯ О ПОСЕТИТЕЛЕ:
- Домен: {{domain}}
- Смотрит товары: {{cartItems}}
- Путь на сайте: {{visitedPages}}
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
        .in('role', ['assistant', 'system'])
        .order('created_at', { ascending: true });
    
    if (after) {
        query = query.gt('created_at', after);
    }

    const { data: messages } = await query;
    return NextResponse.json({ newMessages: messages || [] }, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    const rateLimitResp = checkRateLimit(req, 'widget-chat', { limit: 30, windowMs: 60_000 }, CORS_HEADERS);
    if (rateLimitResp) return rateLimitResp;

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

        if (session && !session.nickname) {
            // Give nickname to old anonymous session
            const newNickname = generateNickname();
            await supabase
                .from('widget_sessions')
                .update({ nickname: newNickname })
                .eq('id', session.id);
            session.nickname = newNickname;
        }

        const sessionId = session!.id;

        // Update session activity timestamp and interested products
        await supabase
            .from('widget_sessions')
            .update({ 
                updated_at: new Date().toISOString(),
                interested_products: visitorData?.cartItems || session.interested_products
            })
            .eq('id', sessionId);

        // ── Калькулятор: пользователь нажал "Получить КП" на конфигураторе ────────
        if (type === 'calc_lead') {
            const { specs, price } = body as { specs?: Record<string, string>, price?: number };

            // Сохраняем товар в сессию
            const productName = specs?.category_name
                ? `${specs.category_name} ${specs.temp || ''}°C / ${specs.volume || ''}л`
                : 'Муфельная печь СНОЛЭКС';
            await supabase.from('widget_sessions')
                .update({ interested_products: [productName] })
                .eq('id', sessionId);

            // Логируем событие
            await supabase.from('widget_events').insert({
                session_id: sessionId,
                event_type: 'calc_lead',
                url: visitorData?.visitedPages?.slice(-1)[0]?.url || null,
                page_title: visitorData?.visitedPages?.slice(-1)[0]?.title || null,
            });

            const volLabel  = specs?.volume ? `${specs.volume} л` : '';
            const tempLabel = specs?.temp   ? `${specs.temp} °C`  : '';
            const phaseLabel = specs?.phase ? `${specs.phase} В`  : '';
            const priceStr = price ? price.toLocaleString('ru-RU') + ' руб.' : '';

            const greeting = `Отличный выбор! 🔥 Вы подобрали СНОЛЭКС ${tempLabel} / ${volLabel} (${phaseLabel}) — ориентировочная цена ${priceStr} с учётом НДС.\n\n🎁 Шаг 1: оставьте email — отправлю КП на фирменном бланке и зафиксирую дополнительные 12 месяцев гарантии.\n🎁 Шаг 2: после email оставьте телефон — подарю умную колонку Яндекс Станция Алиса Мини и закреплю бесплатный шеф-монтаж.`;

            await supabase.from('widget_messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: greeting,
            });

            return NextResponse.json({ reply: greeting }, { headers: CORS_HEADERS });
        }

        // Load existing order details if visitor campaign points to an order
        let existingOrderId: number | null = null;
        const utmCampaign = visitorData?.utm?.campaign || session?.utm_campaign;
        if (utmCampaign) {
            const m = String(utmCampaign).match(/\d+/);
            if (m) {
                existingOrderId = parseInt(m[0]);
            }
        }

        let crmOrder: any = null;
        let orderItemsText = '';
        if (existingOrderId) {
            try {
                const { fetchRetailCrmOrder } = await import('@/lib/retailcrm/orders');
                crmOrder = await fetchRetailCrmOrder(existingOrderId);
                if (crmOrder?.items) {
                    orderItemsText = crmOrder.items
                        .map((it: any) => {
                            const name = it.offer?.displayName || it.productName || '';
                            const qty = it.quantity ? ` (${it.quantity} шт)` : '';
                            return `${name}${qty}`;
                        })
                        .filter(Boolean)
                        .join(', ');
                }
            } catch (err) {
                console.error('Error fetching order context for widget:', err);
            }
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

            const { count: assistantMsgCount } = await supabase
                .from('widget_messages')
                .select('*', { count: 'exact', head: true })
                .eq('session_id', sessionId)
                .eq('role', 'assistant');

            if ((assistantMsgCount || 0) === 0) {
                let greeting = '';
                if (crmOrder) {
                    let clientName = crmOrder.firstName || '';
                    if (clientName) {
                        clientName = clientName.split(' ')[0].trim(); // Take only the first name
                    }
                    const orderNum = crmOrder.number || String(existingOrderId);
                    const itemsLabel = orderItemsText ? ` по поводу ${orderItemsText}` : '';
                    
                    if (clientName) {
                        greeting = `Здравствуйте, ${clientName}! Я Елена, инженер-консультант ЗМК. Вижу Ваше обращение${itemsLabel} (заказ №${orderNum}).\n\nЯ помогу Вам быстро согласовать технические параметры оборудования и подготовить коммерческое предложение. Скажите, пожалуйста, к какому сроку Вам желательно получить оборудование на объекте и требуется ли стандартная комплектация или есть особые требования?`;
                    } else {
                        greeting = `Здравствуйте! Подскажите, пожалуйста, как я могу к Вам обращаться?\n\nЯ Елена, инженер-консультант ЗМК. Вижу Ваше обращение${itemsLabel} (заказ №${orderNum}). Я помогу Вам согласовать технические параметры оборудования и подготовить коммерческое предложение. Скажите также, к какому сроку Вам желательно получить оборудование на объекте?`;
                    }
                } else {
                    greeting = (visitorData?.cartItems?.length > 0)
                        ? `Здравствуйте! Я Елена, эксперт завода ЗМК. Вижу, вы интересовались "${visitorData.cartItems[0]}". Подскажите, для каких задач вы выбираете печь (обжиг керамики, закалка металла или лаборатория) и в какой город планируется доставка? Помогу рассчитать логистику и подобрать оптимальную комплектацию.`
                        : "Добрый день! Я Елена, эксперт завода ЗМК. Помогу подобрать печь под ваши параметры и рассчитать доставку. Подскажите, для каких задач выбираете оборудование (обжиг, закалка или лаборатория) и в какой город планируется доставка?";
                }
                
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

            return NextResponse.json({ 
                success: true
            }, { headers: CORS_HEADERS });
        }

        // Callback form submission from widget UI (name + phone + optional company)
        if (type === 'callback') {
            const { name, phone, company } = body as { name?: string; phone?: string; company?: string };
            const normalized = phone ? normalizePhone(phone) : null;

            if (!name || !normalized) {
                return NextResponse.json({ error: 'Name and valid phone are required' }, { status: 400, headers: CORS_HEADERS });
            }

            await Promise.all([
                supabase
                    .from('widget_sessions')
                    .update({
                        has_contacts: true,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', sessionId),
                supabase.from('widget_messages').insert({
                    session_id: sessionId,
                    role: 'user',
                    content: `Контакт для связи: ${name}, телефон ${normalized}${company ? `, компания ${company}` : ''}`,
                }),
                supabase.from('widget_callback_requests').insert({
                    session_id: sessionId,
                    visitor_id: visitorId,
                    phone: normalized,
                    status: 'pending'
                })
            ]);

            return NextResponse.json({ success: true, phone: normalized }, { headers: CORS_HEADERS });
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

        // Детекция контактов — ДО вызова OpenAI, чтобы не потерять данные при ошибке GPT
        const phoneMatch = message.match(/(\+7|8|7)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
        let normalizedPhone: string | null = null;
        if (phoneMatch) {
            normalizedPhone = normalizePhone(phoneMatch[0]);
            if (normalizedPhone) {
                await supabase
                    .from('widget_sessions')
                    .update({ 
                        has_contacts: true,
                        contact_phone: normalizedPhone
                    })
                    .eq('id', sessionId);
                await supabase.from('widget_callback_requests').insert({
                    session_id: sessionId,
                    visitor_id: visitorId,
                    phone: normalizedPhone,
                    status: 'pending'
                });
            }
        }
        const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
            await supabase.from('widget_sessions').update({ 
                has_contacts: true,
                contact_email: emailMatch[0]
            }).eq('id', sessionId);
        }

        // Жёсткий сценарий лид-капчера: сначала email (КП + гарантия), затем телефон (Алиса Мини + шеф-монтаж)
        if (emailMatch && !normalizedPhone) {
            const email = emailMatch[0];
            const emailReply = `✅ Email ${email} зафиксировала. Отправляю официальное КП и технический паспорт изделия на почту. Также закрепила за вами дополнительную гарантию 12 месяцев.\n\n🎁 Следующий шаг: оставьте телефон для связи — зафиксирую подарок Яндекс Станцию Алиса Мини и бесплатный шеф-монтаж (удаленная пусконаладка инженером).`;
            await supabase.from('widget_messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: emailReply,
            });
            return NextResponse.json({ reply: emailReply }, { headers: CORS_HEADERS });
        }

        if (normalizedPhone) {
            const emailInDb = session?.contact_email;
            const hasEmail = emailInDb || emailMatch;

            let phoneReply = '';
            if (hasEmail) {
                phoneReply = `🔥 Отлично! Телефон ${normalizedPhone} зафиксировала. Полный пакет бонусов (Яндекс Станция Алиса Мини, бесплатный шеф-монтаж и расширенная гарантия 24 месяца) закреплен за вами!\n\nМенеджер свяжется с вами в течение 15 минут для подтверждения деталей.`;
            } else {
                phoneReply = `🔥 Отлично! Телефон ${normalizedPhone} зафиксировала. Запланировала звонок менеджера в течение 15 минут и закрепила за вами бесплатный шеф-монтаж.\n\n🎁 Следующий шаг: напишите ваш email — я отправлю туда КП, технический паспорт изделия и зафиксирую подарок Яндекс Станцию Алиса Мини.`;
            }

            await supabase.from('widget_messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: phoneReply,
            });
            return NextResponse.json({ reply: phoneReply }, { headers: CORS_HEADERS });
        }

        const embeddingRes = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: message,
        });
        await recordAiUsage({ agentId: AiAgent.EMBEDDINGS, model: embeddingRes.model, usage: embeddingRes.usage, purpose: 'widget_embedding' });
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

        let systemPrompt = SYSTEM_PROMPT_TEMPLATE
            .replace('{{domain}}', visitorData?.domain || '')
            .replace('{{cartItems}}', visitorData?.cartItems?.join(', ') || '')
            .replace('{{visitedPages}}', visitorData?.visitedPages?.slice(-3).map((p: any) => p.title).join(', ') || '')
            .replace('{{knowledgeContext}}', knowledgeContext);

        if (crmOrder) {
            const clientName = crmOrder.firstName || 'не указано';
            const orderNum = crmOrder.number || String(existingOrderId);
            
            systemPrompt += `\n\nДАННЫЕ ТЕКУЩЕГО ЗАКАЗА КЛИЕНТА (ОЧЕНЬ ВАЖНО):
- Номер заказа: ${orderNum}
- Имя клиента: ${clientName}
- Заказанные позиции: ${orderItemsText || 'не указаны'}
- Источник перехода: переход из письма РОП-бота.

ПРАВИЛО: Ты уже знаешь имя клиента (${clientName}) и его заказ №${orderNum}. Обращайся к нему по имени. Твоя задача — провести квалификацию по этому заказу (срок, характеристики, оплата). Тебе НЕ нужно собирать его имя, телефон или email заново, если они уже указаны в заказе. Просто уточни недостающие детали и подтверди их.`;
        }

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, ...chatHistory, { role: 'user', content: message }],
            temperature: 0.7
        });
        await recordAiUsage({ agentId: AiAgent.ELENA, model: response.model, usage: response.usage, purpose: 'widget_chat' });

        const reply = response.choices[0].message.content || 'Чем могу помочь?';
        
        await supabase.from('widget_messages').insert({
            session_id: sessionId,
            role: 'assistant',
            content: reply
        });

        return NextResponse.json({ reply }, { headers: CORS_HEADERS });

    } catch (error: any) {
        console.error('Widget API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
    }
}
