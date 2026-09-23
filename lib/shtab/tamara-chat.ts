import { supabase } from '@/utils/supabase';
import { generateEmbedding } from '@/lib/embeddings';
import { isOpenAIConfigured } from '@/utils/openai';
import { getTamaraPrompt, parseStructured, runTamara } from '@/lib/shtab/tamara';

// Разговор с Тамарой: несколько чатов, память между ними и пересказ хвоста.
//
// Зачем три разных хранилища, а не одно:
//
//   shtab_tamara_message — дословная переписка. Её читает человек.
//   shtab_tamara_chat.summary — пересказ того, что уже не влезает в контекст.
//   shtab_tamara_memory — то, что обязано пережить сам чат: решения владельца,
//       обстоятельства, договорённости. Ищется по смыслу и подмешивается в
//       ЛЮБОЙ чат, потому что владелец один и решения у него общие.
//
// Чего в памяти нет и быть не должно — чисел о компании. Число, осевшее в
// памяти, через неделю устареет, а Тамара повторит его как сегодняшнее. Числа
// она каждый раз берёт инструментами заново; в памяти живут решения и уговоры.

/** Сколько последних реплик уходит модели дословно. */
export const TAIL_DEPTH = 12;

/** После скольких несвёрнутых реплик пересобирается пересказ. */
const SUMMARY_EVERY = 16;

const MEMORY_THRESHOLD = 0.3;
const MEMORY_LIMIT = 6;

export type TamaraChat = {
    id: number;
    title: string;
    summary: string;
    summary_upto_id: number | null;
    archived: boolean;
    created_at: string;
    updated_at: string;
};

export type TamaraChatMessage = {
    id: number;
    chat_id: number | null;
    role: 'user' | 'assistant';
    text: string;
    used_tools: Array<{ name: string; args: unknown }>;
    created_at: string;
};

const CHAT_COLUMNS = 'id, title, summary, summary_upto_id, archived, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, chat_id, role, text, used_tools, created_at';

export async function listChats(includeArchived = false): Promise<TamaraChat[]> {
    let q = supabase.from('shtab_tamara_chat').select(CHAT_COLUMNS).order('updated_at', { ascending: false });
    if (!includeArchived) q = q.eq('archived', false);
    const { data, error } = await q.limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as TamaraChat[];
}

export async function createChat(title = 'Новый разговор'): Promise<TamaraChat> {
    const { data, error } = await supabase
        .from('shtab_tamara_chat')
        .insert({ title: title.trim() || 'Новый разговор' })
        .select(CHAT_COLUMNS)
        .single();
    if (error) throw new Error(error.message);
    return data as TamaraChat;
}

export async function getChat(id: number): Promise<TamaraChat | null> {
    const { data, error } = await supabase.from('shtab_tamara_chat').select(CHAT_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TamaraChat) ?? null;
}

/**
 * Чат, в который писать, если владелец не выбрал никакого.
 *
 * Новый чат здесь не заводится про запас: пустые «Новый разговор» копились бы
 * от каждого открытия раздела. Заводится он только когда есть что записать.
 */
export async function latestChat(): Promise<TamaraChat | null> {
    const chats = await listChats();
    return chats[0] ?? null;
}

export async function messagesOfChat(chatId: number, limit = 200): Promise<TamaraChatMessage[]> {
    const { data, error } = await supabase
        .from('shtab_tamara_message')
        .select(MESSAGE_COLUMNS)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as TamaraChatMessage[]).reverse();
}

/** Хвост разговора — то, что модель читает дословно. */
export async function chatTail(chatId: number, limit = TAIL_DEPTH): Promise<TamaraChatMessage[]> {
    return messagesOfChat(chatId, limit);
}

export function formatTail(tail: TamaraChatMessage[]): string {
    if (tail.length === 0) return 'Этот разговор только начинается.';
    return tail.map((m) => `${m.role === 'user' ? 'Владелец' : 'Тамара'}: ${m.text}`).join('\n\n');
}

export type MemoryHit = { id: number; fact: string; kind: string; created_at: string; similarity: number };

/** Поиск по памяти. Сбой поиска не должен ронять разговор — как и у знаний. */
export async function searchMemory(query: string): Promise<MemoryHit[]> {
    if (!isOpenAIConfigured() || !query.trim()) return [];
    try {
        const embedding = await generateEmbedding(query);
        const { data, error } = await supabase.rpc('match_shtab_tamara_memory', {
            query_embedding: embedding,
            match_threshold: MEMORY_THRESHOLD,
            match_count: MEMORY_LIMIT,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as MemoryHit[];
    } catch {
        return [];
    }
}

const KIND_TITLES: Record<string, string> = {
    decision: 'решение',
    context: 'обстоятельство',
    preference: 'как работать',
};

export function formatMemory(hits: MemoryHit[]): string {
    if (hits.length === 0) return 'Ничего из прошлых разговоров по этой теме не отложилось.';
    return hits.map((h) => `— [${KIND_TITLES[h.kind] ?? h.kind}] ${h.fact}`).join('\n');
}

export function formatSummary(chat: TamaraChat | null): string {
    if (!chat?.summary.trim()) return 'Пересказа пока нет — разговор целиком в хвосте ниже.';
    return chat.summary;
}

export async function saveTurn(opts: {
    chatId: number;
    question: string;
    reply: string;
    usedTools: Array<{ name: string; args: unknown }>;
}): Promise<void> {
    // used_tools у вопроса — пустой массив, а не пропуск поля: в пакетной
    // вставке PostgREST приводит строки к одному набору колонок и подставляет
    // в недостающую явный NULL мимо DEFAULT, а на колонке стоит NOT NULL.
    const { error } = await supabase.from('shtab_tamara_message').insert([
        { chat_id: opts.chatId, role: 'user', text: opts.question, used_tools: [] },
        { chat_id: opts.chatId, role: 'assistant', text: opts.reply, used_tools: opts.usedTools },
    ]);
    if (error) throw new Error(error.message);

    await supabase.from('shtab_tamara_chat').update({ updated_at: new Date().toISOString() }).eq('id', opts.chatId);
}

/** Название чата по первому вопросу: длинные заголовки в списке всё равно режутся. */
export function titleFromQuestion(question: string): string {
    const clean = question.replace(/\s+/g, ' ').trim();
    if (clean.length <= 48) return clean;
    return `${clean.slice(0, 47)}…`;
}

type DigestResult = {
    summary: string;
    memory: Array<{ fact: string; kind: 'decision' | 'context' | 'preference' }>;
};

const DIGEST_SCHEMA = {
    name: 'tamara_digest',
    schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'memory'],
        properties: {
            summary: { type: 'string' },
            memory: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['fact', 'kind'],
                    properties: {
                        fact: { type: 'string' },
                        kind: { type: 'string', enum: ['decision', 'context', 'preference'] },
                    },
                },
            },
        },
    },
} as const;

/**
 * Свернуть накопившееся: пересобрать пересказ чата и вынуть из него то, что
 * стоит помнить и дальше.
 *
 * Вызывается после ответа и своими ошибками разговор не роняет: пересказ —
 * удобство, а не условие работы. Если свёртка не удалась, чат просто останется
 * с прежним пересказом и попробует свернуться в следующий раз.
 */
export async function digestChat(chatId: number): Promise<{ summarized: boolean; remembered: number }> {
    const chat = await getChat(chatId);
    if (!chat) return { summarized: false, remembered: 0 };

    const { data: fresh, error } = await supabase
        .from('shtab_tamara_message')
        .select(MESSAGE_COLUMNS)
        .eq('chat_id', chatId)
        .gt('id', chat.summary_upto_id ?? 0)
        .order('id', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (fresh ?? []) as TamaraChatMessage[];
    // Свёртка идёт с запасом: хвост TAIL_DEPTH модель и так читает дословно,
    // сворачивать надо только то, что за него вышло.
    if (rows.length < SUMMARY_EVERY) return { summarized: false, remembered: 0 };

    const prompt = await getTamaraPrompt('shtab_tamara_digest');
    const transcript = rows.map((m) => `${m.role === 'user' ? 'Владелец' : 'Тамара'}: ${m.text}`).join('\n\n');
    const answer = await runTamara({
        prompt,
        purpose: 'shtab_tamara_digest',
        withTools: false,
        schema: DIGEST_SCHEMA as any,
        userContent: `Прежний пересказ:\n${chat.summary || '(пусто)'}\n\nНовые реплики:\n${transcript}`,
    });
    const digest = parseStructured<DigestResult>(answer.reply, 'Свёртка разговора');

    const upto = rows[rows.length - 1]?.id ?? chat.summary_upto_id ?? null;
    const { error: updError } = await supabase
        .from('shtab_tamara_chat')
        .update({ summary: digest.summary, summary_upto_id: upto, updated_at: new Date().toISOString() })
        .eq('id', chatId);
    if (updError) throw new Error(updError.message);

    let remembered = 0;
    for (const item of digest.memory.slice(0, 10)) {
        const fact = item.fact.trim();
        if (!fact) continue;
        // Дубли памяти — реальная беда: один и тот же уговор, записанный пять
        // раз, займёт всю выдачу поиска. Близкое по смыслу уже лежащее считаем
        // тем же самым и не пишем повторно.
        const near = await searchMemory(fact);
        if (near.some((n) => n.similarity > 0.93)) continue;
        let embedding: number[] | null = null;
        try {
            embedding = await generateEmbedding(fact);
        } catch {
            embedding = null;
        }
        const { error: insError } = await supabase
            .from('shtab_tamara_memory')
            .insert({ fact, kind: item.kind, chat_id: chatId, embedding });
        if (!insError) remembered += 1;
    }

    return { summarized: true, remembered };
}
