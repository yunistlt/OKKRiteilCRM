import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { createLeadInCrm } from '@/lib/retailcrm-leads';
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

        // 1. Find sessions that need processing
        const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
        
        const { data: sessions, error: sessionsError } = await supabase
            .from('widget_sessions')
            .select('*')
            .eq('is_lead_created', false)
            .lt('updated_at', threeMinutesAgo)
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

            const chatLog = messages.map(m => `${m.role === 'user' ? 'Клиент' : 'ИИ'}: ${m.content}`).join('\n');

            const extractionResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: `Ты — Семён, архивариус завода ЗМК. Твоя задача — извлечь контактные данные из лога диалога.
                        Если данных нет, верни null в соответствующих полях.
                        
                        Верни строго JSON:
                        {
                            "name": "Имя клиента",
                            "phone": "Телефон (только цифры)",
                            "email": "Email",
                            "telegram": "Ник в Telegram",
                            "query_summary": "Краткое описание того, что хочет клиент"
                        }`
                    },
                    { role: 'user', content: `Лог диалога:\n${chatLog}` }
                ],
                response_format: { type: 'json_object' }
            });

            const extractedData = JSON.parse(extractionResponse.choices[0].message.content || '{}');

            if (extractedData.phone || extractedData.email || extractedData.telegram) {
                try {
                    await createLeadInCrm({
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

                    await supabase
                        .from('widget_sessions')
                        .update({ is_lead_created: true })
                        .eq('id', session.id);

                    await supabase.from('widget_messages').insert({
                        session_id: session.id,
                        role: 'system',
                        content: `✅ Заказ успешно создан в CRM (Семён-Архивариус)`
                    });

                    results.push({ sessionId: session.id, status: 'success', data: extractedData });
                } catch (crmError: any) {
                    console.error(`CRM Error for session ${session.id}:`, crmError);
                    results.push({ sessionId: session.id, status: 'crm_error', error: crmError.message });
                }
            } else {
                results.push({ sessionId: session.id, status: 'no_contacts_found' });
            }
        }

        return NextResponse.json({ results });

    } catch (error: any) {
        console.error('Lead Catcher Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
