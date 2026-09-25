import { supabase } from '@/utils/supabase';

/**
 * Чтение исходного кода проекта.
 *
 * Тамара разбирается в работе компании, а работа компании наполовину состоит из
 * того, что делает этот сервис: как бот считает нагрузку, что попадает в план,
 * почему в отчёте именно эта строка. Раньше она могла отвечать только по
 * данным и по базе знаний, и на вопрос «как это устроено» честно молчала.
 *
 * Код доступен только на чтение и только через снимок в базе
 * (project_code_file), который заливает scripts/index-project-code.ts. Снимок
 * несёт коммит и дату — ответ обязан на них ссылаться, иначе «в коде написано»
 * невозможно перепроверить.
 */

export type CodeHit = {
    path: string;
    lang: string | null;
    lines: number;
    /** Строки с совпадением и немного вокруг — как grep -C. */
    excerpt: string;
    matches: number;
};

export type CodeSnapshot = { commit_sha: string; branch: string | null; files: number; taken_at: string };

export async function getCodeSnapshot(): Promise<CodeSnapshot | null> {
    const { data, error } = await supabase
        .from('project_code_snapshot')
        .select('commit_sha, branch, files, taken_at')
        .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as CodeSnapshot) ?? null;
}

/** Вырезка вокруг совпадений — то, что показал бы grep с контекстом. */
function excerptAround(content: string, needle: string, context = 3, maxBlocks = 4): { excerpt: string; matches: number } {
    const lines = content.split('\n');
    const lower = needle.toLowerCase();
    const hits: number[] = [];
    lines.forEach((line, i) => {
        if (line.toLowerCase().includes(lower)) hits.push(i);
    });
    if (hits.length === 0) return { excerpt: '', matches: 0 };

    const blocks: string[] = [];
    let cursor = -1;
    for (const hit of hits) {
        if (blocks.length >= maxBlocks) break;
        if (hit <= cursor) continue; // уже попал в предыдущий блок
        const from = Math.max(0, hit - context);
        const to = Math.min(lines.length - 1, hit + context);
        cursor = to;
        const body = lines
            .slice(from, to + 1)
            .map((l, k) => `${String(from + k + 1).padStart(4)}| ${l}`)
            .join('\n');
        blocks.push(body);
    }
    const more = hits.length > maxBlocks ? `\n… ещё совпадений: ${hits.length - maxBlocks}` : '';
    return { excerpt: blocks.join('\n   --\n') + more, matches: hits.length };
}

/**
 * Поиск по коду подстрокой — то же, чем пользуется человек.
 *
 * Не по смыслу: смысловой поиск по коду промахивается там, где важнее всего
 * точность, — имя ключа, название таблицы, вызов функции ищутся буквально.
 */
export async function searchCode(opts: {
    query: string;
    pathLike?: string;
    limit?: number;
}): Promise<{ hits: CodeHit[]; total: number; snapshot: CodeSnapshot | null }> {
    const query = opts.query.trim();
    if (!query) throw new Error('Пустой запрос к коду');
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);

    let q = supabase
        .from('project_code_file')
        .select('path, lang, lines, content', { count: 'exact' })
        // ilike — подстрока без учёта регистра; спецсимволы шаблона экранируем,
        // иначе `%` в запросе молча расширит поиск на весь репозиторий.
        .ilike('content', `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
        .order('path')
        .limit(limit);
    if (opts.pathLike) q = q.ilike('path', `%${opts.pathLike.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const hits: CodeHit[] = ((data ?? []) as any[]).map((row) => {
        const { excerpt, matches } = excerptAround(String(row.content), query);
        return { path: row.path, lang: row.lang, lines: row.lines, excerpt, matches };
    });

    return { hits, total: count ?? hits.length, snapshot: await getCodeSnapshot() };
}

/** Список файлов по куску пути — чтобы сориентироваться, где что лежит. */
export async function listCodeFiles(pathLike: string, limit = 40): Promise<Array<{ path: string; lines: number }>> {
    const { data, error } = await supabase
        .from('project_code_file')
        .select('path, lines')
        .ilike('path', `%${pathLike.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
        .order('path')
        .limit(Math.min(Math.max(limit, 1), 100));
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ path: string; lines: number }>;
}

/** Максимум строк за одно чтение: больше модель всё равно не удержит в голове. */
const MAX_READ_LINES = 400;

export async function readCodeFile(
    path: string,
    opts: { from?: number; lines?: number } = {},
): Promise<{ path: string; total: number; from: number; to: number; text: string; snapshot: CodeSnapshot | null }> {
    const { data, error } = await supabase
        .from('project_code_file')
        .select('path, content, lines')
        .eq('path', path)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Файла ${path} в снимке кода нет. Посмотри список файлов по куску пути.`);

    const all = String(data.content).split('\n');
    const from = Math.max(1, opts.from ?? 1);
    const want = Math.min(opts.lines ?? MAX_READ_LINES, MAX_READ_LINES);
    const to = Math.min(all.length, from + want - 1);
    const text = all
        .slice(from - 1, to)
        .map((l, i) => `${String(from + i).padStart(4)}| ${l}`)
        .join('\n');

    return { path, total: all.length, from, to, text, snapshot: await getCodeSnapshot() };
}
