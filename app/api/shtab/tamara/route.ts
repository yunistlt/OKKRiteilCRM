import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import {
    formatHistory,
    formatKnowledge,
    getTamaraPrompt,
    loadHistory,
    renderTemplate,
    runTamara,
    searchTamaraKnowledge,
} from '@/lib/shtab/tamara';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET  /api/shtab/tamara — история разговора и свежая понедельничная сводка.
// POST /api/shtab/tamara — задать вопрос.
//
// Доступ: RBAC /api/shtab → только admin. Разговор один на компанию, как и Штаб.

const AskSchema = z.object({
    question: z.string().trim().min(1, 'Пустой вопрос').max(2000),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const [messagesRes, briefingRes] = await Promise.all([
            supabase
                .from('shtab_tamara_message')
                .select('id, role, text, created_at')
                .order('created_at', { ascending: false })
                .limit(30),
            supabase
                .from('shtab_briefing')
                .select('week_start, text, created_at')
                .order('week_start', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);
        if (messagesRes.error) throw new Error(messagesRes.error.message);
        if (briefingRes.error) throw new Error(briefingRes.error.message);

        return NextResponse.json({
            messages: (messagesRes.data ?? []).reverse(),
            briefing: briefingRes.data ?? null,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const parsed = AskSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Некорректные данные' }, { status: 400 });
        }
        const question = parsed.data.question;

        const [prompt, history, knowledge] = await Promise.all([
            getTamaraPrompt('shtab_tamara_chat'),
            loadHistory(),
            searchTamaraKnowledge(question),
        ]);

        const answer = await runTamara({
            prompt,
            purpose: 'shtab_tamara_chat',
            userContent: renderTemplate(prompt.userPromptTemplate, {
                question,
                knowledge_context: formatKnowledge(knowledge),
                history_context: formatHistory(history),
            }),
        });

        // Пишем обе реплики после ответа: если модель не ответила, вопрос не
        // должен висеть в истории без пары и портить контекст следующего захода.
        const { error: insertError } = await supabase.from('shtab_tamara_message').insert([
            { role: 'user', text: question },
            { role: 'assistant', text: answer.reply, used_tools: answer.usedTools },
        ]);
        if (insertError) throw new Error(insertError.message);

        return NextResponse.json({
            reply: answer.reply,
            used_tools: answer.usedTools.map((t) => t.name),
            knowledge: knowledge.map((k) => ({ title: k.title, source: k.source_ref })),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
