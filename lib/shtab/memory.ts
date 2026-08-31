import { supabase } from '@/utils/supabase';
import { generateEmbedding } from '@/lib/embeddings';
import { isOpenAIConfigured } from '@/utils/openai';
import { kbFingerprint } from '@/lib/shtab/kb-seed';

// Память Тамары: указатель, а не хранилище.
//
// Два слоя, и они делают разное. В базе знаний (shtab_kb, тип 'company') лежит
// подробность: вопрос, ответ владельца дословно, дата. В памяти — одна строка на
// тему: «про это знаю, лежит под таким-то slug». Самого факта в памяти нет.
//
// Память грузится в КАЖДЫЙ запрос, поэтому она ограничена по числу строк и по
// длине строки. Без ограничения она за полгода станет вторым контекстом, который
// вытеснит собственно разговор, и виноват будет не объём, а отсутствие границы.
//
// Достать факт можно двумя путями: по вектору вместе с остальным знанием и
// напрямую по slug из памяти. Второй путь главный: он работает и без OpenAI.
// Иначе память обещала бы то, чего поиск не находит.

/** Сколько живых строк памяти уходит в промпт. Дальше — только по вектору и по slug. */
export const MEMORY_LIMIT = 60;

/** Предел длины отметки. Длиннее — это уже содержание, ему место в базе знаний. */
export const NOTE_MAX = 180;

export type MemoryRow = {
    id: number;
    topic: string;
    note: string;
    kb_slug: string;
    asked: string;
    source: string;
    created_at: string;
};

export type FactSource = 'owner' | 'tseh' | 'doc';

const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Slug темы. Устойчивый: одна и та же тема даёт один и тот же slug, поэтому
 * повторный ответ по теме перезаписывает запись, а не плодит вторую. Разные
 * записи по одной теме — это два «факта» об одном, и Тамара выберет случайный.
 */
export function topicSlug(topic: string): string {
    const body = topic
        .toLowerCase()
        .split('')
        .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    // Пустой slug получается, если тема набрана одними знаками препинания.
    // Молча подставить «company-» нельзя: две такие темы столкнутся в один slug
    // и второй факт затрёт первый.
    return body ? `company-${body}` : '';
}

/** Обрезка отметки до предела с многоточием — чтобы граница была видна, а не догадывалась. */
export function trimNote(note: string): string {
    const one = note.replace(/\s+/g, ' ').trim();
    return one.length <= NOTE_MAX ? one : `${one.slice(0, NOTE_MAX - 1)}…`;
}

/**
 * Живая память. Только незакрытые строки: закрытая — это факт, который владелец
 * потом поправил, и подставлять его обратно нельзя.
 */
export async function loadMemory(limit = MEMORY_LIMIT): Promise<MemoryRow[]> {
    const { data, error } = await supabase
        .from('shtab_memory')
        .select('id, topic, note, kb_slug, asked, source, created_at')
        .is('superseded_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw new Error(`Память не поднялась: ${error.message}`);
    return (data || []) as MemoryRow[];
}

/**
 * Блок ПАМЯТЬ для промпта. Возраст указывается явно: факт годовой давности и
 * факт вчерашний — разного веса, и модель должна видеть разницу, а не считать
 * всю память одинаково свежей.
 */
export function formatMemory(rows: readonly MemoryRow[], now: Date = new Date()): string {
    if (rows.length === 0) {
        return 'ПАМЯТЬ\nПусто: о компании пока не выяснено ничего. Не хватает факта — спроси владельца.';
    }
    const lines = rows.map((r) => {
        const days = Math.floor((now.getTime() - new Date(r.created_at).getTime()) / 86400000);
        const age = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} дн. назад`;
        return `- ${r.topic}: ${r.note} [${r.kb_slug}, ${age}, со слов: ${r.source}]`;
    });
    return [
        'ПАМЯТЬ — по этим темам факт уже выяснен, повторно не спрашивай.',
        'Подробность лежит в базе знаний под указанным slug: возьми её инструментом shtab_fakt.',
        ...lines,
    ].join('\n');
}

/** Факт целиком по slug. Прямой путь, работающий без векторного поиска. */
export async function factBySlug(slug: string): Promise<{ slug: string; title: string; content: string; source_ref: string } | null> {
    const { data, error } = await supabase
        .from('shtab_kb')
        .select('slug, title, content, source_ref')
        .eq('slug', slug)
        .eq('type', 'company')
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw new Error(`Факт ${slug} не поднялся: ${error.message}`);
    return data ? (data as { slug: string; title: string; content: string; source_ref: string }) : null;
}

export type RememberInput = {
    /** Тема одним словосочетанием: «начальники цеха», «печать ярлыков». */
    topic: string;
    /** Что спросили — дословно. Владелец должен видеть, на что он отвечал. */
    asked: string;
    /** Что ответил владелец — дословно, без пересказа. */
    answer: string;
    /** Отметка «что известно» для памяти. Пусто — соберём из ответа. */
    note?: string;
    source?: FactSource;
};

/**
 * Тело записи в базу знаний. Собирается по одному образцу, потому что по нему
 * потом ищут: вопрос и ответ рядом дают вектору и то и другое.
 *
 * Ответ владельца идёт ДОСЛОВНО и помечен как его слова. Пересказ здесь — это
 * тихая подмена: через месяц никто не отличит, что сказал владелец, а что
 * додумала Тамара, и проверить будет нечем.
 */
export function factBody(input: RememberInput, at: Date = new Date()): string {
    const day = at.toISOString().slice(0, 10);
    const who = input.source === 'tseh' ? 'из ЦехУспеха' : input.source === 'doc' ? 'из документа' : 'со слов владельца';
    return [
        `Тема: ${input.topic.trim()}`,
        `Вопрос: ${input.asked.trim() || '—'}`,
        `Ответ (${who}, ${day}), дословно:`,
        input.answer.trim(),
    ].join('\n');
}

export type RememberResult =
    | { ok: true; id: number; slug: string; embedded: boolean }
    | { ok: false; reason: string };

/**
 * Записывает факт в оба слоя одной транзакцией (функция shtab_remember).
 *
 * Эмбеддинг считается здесь, до записи: это платный вызов, и в SQL ему не место.
 * Не посчитался — пишем без вектора и честно сообщаем об этом: факт достанется
 * по slug из памяти. Отказаться от записи из-за недоступного OpenAI было бы
 * хуже — ответ владельца потерялся бы, а спросить второй раз про то же нельзя.
 */
export async function rememberFact(input: RememberInput): Promise<RememberResult> {
    const topic = input.topic.trim();
    if (!topic) return { ok: false, reason: 'Не названа тема — без неё факт нечем найти и нечем перезаписать' };
    if (!input.answer.trim()) return { ok: false, reason: 'Пустой ответ: записывать нечего' };

    const slug = topicSlug(topic);
    if (!slug) return { ok: false, reason: 'Из темы не получается slug — назови тему словами, а не знаками' };

    const content = factBody(input);
    const note = trimNote(input.note?.trim() || input.answer);

    let embedding: number[] | null = null;
    if (isOpenAIConfigured()) {
        try {
            embedding = await generateEmbedding(content);
        } catch {
            // Молча остаёмся без вектора: путь по slug работает и без него.
            embedding = null;
        }
    }

    const { data, error } = await supabase.rpc('shtab_remember', {
        p_topic: topic,
        p_note: note,
        p_slug: slug,
        p_title: topic,
        p_content: content,
        p_asked: input.asked.trim(),
        p_source: input.source || 'owner',
        p_source_ref: input.source === 'tseh' ? 'ЦехУспех' : 'владелец',
        p_embedding: embedding ? `[${embedding.join(',')}]` : null,
        p_fingerprint: kbFingerprint(content),
    });
    if (error) return { ok: false, reason: `Не удалось записать: ${error.message}` };

    return { ok: true, id: Number(data), slug, embedded: embedding !== null };
}
