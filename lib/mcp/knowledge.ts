import { ident, lit, runSelect } from '@/lib/mcp/sql';
import { getSchema } from '@/lib/mcp/schema';
import { fragment } from '@/lib/mcp/search';

// Базы знаний ОКК глазами коннектора.
//
// Баз несколько, у каждой свои колонки. Здесь — только соответствие «что в этой
// таблице заголовок, что текст, что рубрика»; названия и описания баз берутся
// из комментария к таблице в самой базе.
//
// Поиск идёт по словам. Поиск по смыслу у этих баз есть, но каждый запрос к нему
// — платный вызов OpenAI за вектор вопроса, поэтому без отдельного решения
// владельца коннектор его не трогает.

type Base = {
    key: string;
    table: string;
    id: string;
    title: string;
    /** Поля текста статьи, по порядку. */
    content: string[];
    /** Рубрика внутри базы. */
    rubric?: string;
    active?: string;
    updated?: string;
};

export const KNOWLEDGE_BASES: Base[] = [
    { key: 'okk_consultant', table: 'okk_consultant_knowledge', id: 'id', title: 'title', content: ['content'], rubric: 'type', active: 'is_active', updated: 'updated_at' },
    { key: 'project', table: 'project_knowledge', id: 'id', title: 'title', content: ['content'], rubric: 'subsystem', active: 'is_active', updated: 'updated_at' },
    { key: 'shtab', table: 'shtab_kb', id: 'id', title: 'title', content: ['content'], rubric: 'type', active: 'is_active', updated: 'updated_at' },
    { key: 'legal_rules', table: 'legal_knowledge', id: 'id', title: 'topic', content: ['rule', 'evidence'], rubric: 'severity', active: 'is_active', updated: 'updated_at' },
    { key: 'legal_consultant', table: 'legal_consultant_knowledge', id: 'id', title: 'title', content: ['content'], rubric: 'type', active: 'is_active', updated: 'updated_at' },
    { key: 'dialogs', table: 'dialog_knowledge', id: 'id', title: 'situation', content: ['response', 'outcome'], rubric: 'domain', active: 'is_active', updated: 'updated_at' },
    { key: 'products', table: 'product_knowledge', id: 'id', title: 'name', content: ['description', 'competitor_notes'], rubric: 'category', updated: 'updated_at' },
    { key: 'faq', table: 'knowledge_base_qa', id: 'id', title: 'intent_slug', content: ['answer_consultant', 'answer_website'], rubric: 'category', active: 'is_active', updated: 'updated_at' },
];

const ARTICLE_CHUNK = 40_000;

/** База и те её колонки из соответствия, которые в таблице действительно есть. */
async function resolve(base: Base) {
    const schema = await getSchema();
    const table = schema.tables.get(base.table);
    if (!table) return null;
    const has = (name?: string) => Boolean(name) && table.columns.some((c) => c.name === name);
    return {
        table,
        content: base.content.filter(has),
        rubric: has(base.rubric) ? base.rubric! : null,
        active: has(base.active) ? base.active! : null,
        updated: has(base.updated) ? base.updated! : null,
    };
}

function baseByKey(key: string): Base {
    const base = KNOWLEDGE_BASES.find((b) => b.key === key || b.table === key);
    if (!base) throw new Error(`Базы знаний «${key}» нет. Доступны: ${KNOWLEDGE_BASES.map((b) => b.key).join(', ')}.`);
    return base;
}

export async function listKnowledgeBases() {
    const bases = [];
    for (const base of KNOWLEDGE_BASES) {
        const r = await resolve(base);
        if (!r) continue;
        const activeOnly = r.active ? `WHERE ${ident(r.active)}` : '';
        const rubric = r.rubric ? `coalesce(${ident(r.rubric)}::text, '—')` : `'—'`;
        const rows = await runSelect<{ rubric: string; n: number }>(
            `SELECT ${rubric} AS rubric, count(*)::int AS n FROM public.${ident(base.table)} ${activeOnly} GROUP BY 1 ORDER BY 2 DESC`,
        );
        bases.push({
            base: base.key,
            table: base.table,
            description: r.table.comment,
            articles: rows.reduce((sum, row) => sum + Number(row.n), 0),
            rubrics: rows.map((row) => ({ rubric: row.rubric, articles: Number(row.n) })),
        });
    }
    return { bases, count: bases.length, note: 'Поиск — search_knowledge, статья целиком — get_article с id вида «база:id».' };
}

export async function searchKnowledge(query: string, baseKey?: string, limit = 8) {
    const q = String(query ?? '').trim();
    if (q.length < 2) throw new Error('Запрос короче двух знаков.');

    const targets = baseKey ? [baseByKey(baseKey)] : KNOWLEDGE_BASES;
    const pattern = lit(`%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`);
    const perBase = Math.min(Math.max(1, limit), 20);
    const articles = [];

    for (const base of targets) {
        const r = await resolve(base);
        if (!r) continue;
        const text = r.content.map((c) => `coalesce(${ident(c)}, '')`).join(` || E'\\n' || `) || `''`;
        const where = [`(${ident(base.title)}::text ILIKE ${pattern} OR (${text}) ILIKE ${pattern})`];
        if (r.active) where.push(ident(r.active));

        // Совпадение в заголовке ценнее совпадения в тексте — оно идёт первым.
        const rows = await runSelect<{ id: unknown; title: string; rubric: string | null; text: string }>(
            `SELECT ${ident(base.id)} AS id, ${ident(base.title)}::text AS title, ${r.rubric ? `${ident(r.rubric)}::text` : 'NULL'} AS rubric,
                    (${text}) AS text
               FROM public.${ident(base.table)} WHERE ${where.join(' AND ')}
              ORDER BY (${ident(base.title)}::text ILIKE ${pattern}) DESC LIMIT ${perBase}`,
        );
        for (const row of rows) {
            articles.push({
                id: `${base.key}:${row.id}`,
                base: base.key,
                title: String(row.title ?? '').slice(0, 200),
                rubric: row.rubric,
                fragment: fragment(row.text, q, 200),
            });
        }
    }

    return {
        query: q,
        articles,
        count: articles.length,
        note: 'Поиск идёт по словам, а не по смыслу: не нашлось — попробуй другое слово или корень слова.',
    };
}

export async function getArticle(ref: string, offset = 0) {
    const at = String(ref ?? '').indexOf(':');
    if (at < 1) throw new Error('Номер статьи — вида «база:id», как его отдаёт search_knowledge.');
    const base = baseByKey(ref.slice(0, at));
    const id = ref.slice(at + 1);

    const r = await resolve(base);
    if (!r) throw new Error(`Таблицы базы «${base.key}» нет.`);

    const columns = r.table.columns.filter((c) => !/^vector/i.test(c.type)).map((c) => ident(c.name));
    const rows = await runSelect(`SELECT ${columns.join(', ')} FROM public.${ident(base.table)} WHERE ${ident(base.id)}::text = ${lit(id)} LIMIT 1`);
    if (rows.length === 0) throw new Error(`Статья «${ref}» не найдена.`);

    const row = rows[0];
    const full = r.content.map((c) => String(row[c] ?? '')).filter(Boolean).join('\n\n');
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const text = full.slice(start, start + ARTICLE_CHUNK);
    const rest = full.length - (start + text.length);

    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        if (!r.content.includes(k) && k !== base.title) extra[k] = v;
    }

    return {
        id: ref,
        base: base.key,
        title: row[base.title],
        updated_at: r.updated ? row[r.updated] : null,
        text,
        next_offset: rest > 0 ? start + text.length : null,
        fields: extra,
    };
}
