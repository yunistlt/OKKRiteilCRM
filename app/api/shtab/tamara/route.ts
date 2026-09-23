import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import {
    formatKnowledge,
    getTamaraPrompt,
    renderTemplate,
    runTamara,
    searchTamaraKnowledge,
} from '@/lib/shtab/tamara';
import {
    chatTail,
    createChat,
    digestChat,
    formatMemory,
    formatSummary,
    formatTail,
    getChat,
    latestChat,
    messagesOfChat,
    saveTurn,
    searchMemory,
    titleFromQuestion,
} from '@/lib/shtab/tamara-chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET  /api/shtab/tamara?chat_id=N — реплики чата и свежая понедельничная сводка.
// POST /api/shtab/tamara — задать вопрос (chat_id необязателен).
//
// Доступ: RBAC /api/shtab → только admin. Чаты общие: Штаб один на компанию.

const AskSchema = z.object({
    question: z.string().trim().min(1, 'Пустой вопрос').max(4000),
    chat_id: z.number().int().positive().optional(),
    /** Глубина размышления. Владелец переключает её сам: долгий разбор стоит дороже. */
    effort: z.enum(['low', 'medium', 'high']).optional(),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const raw = req.nextUrl.searchParams.get('chat_id');
        const chat = raw ? await getChat(Number(raw)) : await latestChat();

        const [messages, briefingRes] = await Promise.all([
            chat ? messagesOfChat(chat.id) : Promise.resolve([]),
            supabase
                .from('shtab_briefing')
                .select('week_start, text, created_at')
                .order('week_start', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);
        if (briefingRes.error) throw new Error(briefingRes.error.message);

        return NextResponse.json({ chat, messages, briefing: briefingRes.data ?? null });
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
        const { question, effort } = parsed.data;

        // Чат заводится под первый же вопрос, а не про запас: иначе каждое
        // открытие раздела оставляло бы пустой «Новый разговор».
        let chat = parsed.data.chat_id ? await getChat(parsed.data.chat_id) : await latestChat();
        if (!chat) chat = await createChat(titleFromQuestion(question));

        const [prompt, tail, knowledge, memory] = await Promise.all([
            getTamaraPrompt('shtab_tamara_chat'),
            chatTail(chat.id),
            searchTamaraKnowledge(question),
            searchMemory(question),
        ]);

        const answer = await runTamara({
            prompt,
            purpose: 'shtab_tamara_chat',
            reasoningEffort: effort ?? 'medium',
            userContent: renderTemplate(prompt.userPromptTemplate, {
                question,
                knowledge_context: formatKnowledge(knowledge),
                memory_context: formatMemory(memory),
                summary_context: formatSummary(chat),
                history_context: formatTail(tail),
            }),
        });

        // Обе реплики пишутся после ответа: не ответила — вопрос не должен
        // висеть в истории без пары и портить контекст следующего захода.
        await saveTurn({ chatId: chat.id, question, reply: answer.reply, usedTools: answer.usedTools });

        // Пустой чат получает имя по первому вопросу — список разговоров без
        // названий бесполезен.
        if (tail.length === 0 && chat.title === 'Новый разговор') {
            await supabase.from('shtab_tamara_chat').update({ title: titleFromQuestion(question) }).eq('id', chat.id);
        }

        // Свёртка — удобство, а не условие работы: её сбой не должен отнимать
        // у владельца уже полученный ответ.
        let digest: { summarized: boolean; remembered: number } = { summarized: false, remembered: 0 };
        try {
            digest = await digestChat(chat.id);
        } catch {
            digest = { summarized: false, remembered: 0 };
        }

        return NextResponse.json({
            chat_id: chat.id,
            reply: answer.reply,
            used_tools: answer.usedTools.map((t) => t.name),
            knowledge: knowledge.map((k) => ({ title: k.title, source: k.source_ref })),
            memory_used: memory.length,
            digest,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
