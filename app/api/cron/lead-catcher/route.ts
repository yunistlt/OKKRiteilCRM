import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { createLeadInCrm } from '@/lib/retailcrm-leads';
import { safeEnqueueSystemJob } from '@/lib/system-jobs';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const authHeader = req.headers.get('authorization');
        // Simple security check for CRON
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            // In development, we might skip this
        }

        // 1. Find sessions that need processing (any session that isn't a lead yet)
        const { data: sessions, error: sessionsError } = await supabase
            .from('widget_sessions')
            .select('*')
            .eq('is_lead_created', false)
            .eq('has_contacts', true) // Берем только те, где Лена нашла контакты
            .order('updated_at', { ascending: false })
            .limit(10);

        if (sessionsError) throw sessionsError;
        if (!sessions || sessions.length === 0) {
            return NextResponse.json({ message: 'No sessions to process' });
        }

        const results = [];

        for (const session of sessions) {
            const { data: messages, error: msgsError } = await supabase
                .from('widget_messages')
                .select('role, content')
                .eq('session_id', session.id)
                .order('created_at', { ascending: true });

            if (msgsError || !messages || messages.length === 0) continue;

            const chatLog = messages.map((m: any) => `${m.role === 'user' ? 'Клиент' : 'ИИ'}: ${m.content}`).join('\n');

            const extractionResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: `Ты — Семён, профессиональный бизнес-аналитик завода ЗМК. Твоя задача — проанализировать диалог и составить КРАТКОЕ, но ЕМКОЕ саммари для менеджера по продажам.
                        
                        В поле query_summary напиши:
                        1. Что именно ищет клиент (модели, размеры).
                        2. Ключевые требования (материал, сроки).
                        3. Куда нужна доставка (город).
                        4. Были ли прикреплены файлы (ТЗ).
                        
                        Верни строго JSON:
                        {
                            "name": "Имя клиента",
                            "phone": "Телефон (только цифры)",
                            "email": "Email",
                            "telegram": "Ник в Telegram",
                            "query_summary": "Структурированная выжимка потребностей клиента"
                        }`
                    },
                    { role: 'user', content: `Лог диалога:\n${chatLog}` }
                ],
                response_format: { type: 'json_object' }
            });

            const extractedData = JSON.parse(extractionResponse.choices[0].message.content || '{}');

            if (extractedData.phone || extractedData.email || extractedData.telegram) {
                try {
                    const crmResult = await createLeadInCrm({
                        name: extractedData.name || session.nickname || 'Клиент из чата',
                        phone: extractedData.phone,
                        email: extractedData.email,
                        telegram: extractedData.telegram,
                        query_summary: extractedData.query_summary,
                        domain: 'zmktlt.ru',
                        city: session.geo_city,
                        history: messages,
                        visitedPages: []
                    });

                    const orderNumber = crmResult.order?.number || crmResult.id?.toString();

                    await supabase
                        .from('widget_sessions')
                        .update({ 
                            is_lead_created: true,
                            crm_order_number: orderNumber
                        })
                        .eq('id', session.id);

                    await supabase.from('widget_messages').insert({
                        session_id: session.id,
                        role: 'system',
                        content: `✅ Заказ #${orderNumber} успешно создан в CRM (Семён-Архивариус)`
                    });

                    // Инициируем звонок через очередь задач
                    if (extractedData.phone) {
                        await safeEnqueueSystemJob({
                            jobType: 'telphin_callback',
                            payload: {
                                visitorId: session.visitor_id,
                                phone: extractedData.phone,
                                sessionId: session.id,
                                crm_order_number: orderNumber
                            },
                            priority: 15,
                            idempotencyKey: `telphin_callback:${extractedData.phone}:${session.id}`
                        });
                    }

                    results.push({ sessionId: session.id, status: 'success', data: extractedData });
                } catch (crmError: any) {
                    console.error(`CRM Error for session ${session.id}:`, crmError);
                    results.push({ sessionId: session.id, status: 'crm_error', error: crmError.message });
                }
            } else {
                // Если контактов нет, все равно помечаем как проверенную, чтобы не зацикливаться
                await supabase
                    .from('widget_sessions')
                    .update({ is_lead_created: true }) // Считаем обработанной (пустой)
                    .eq('id', session.id);
                    
                results.push({ sessionId: session.id, status: 'no_contacts_found' });
            }
        }

        return NextResponse.json({ results });

    } catch (error: any) {
        console.error('Lead Catcher Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
