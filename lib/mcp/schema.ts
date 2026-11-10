import { supabase } from '@/utils/supabase';
import { runSelect } from '@/lib/mcp/sql';

// Карта данных ОКК для коннектора: какие есть таблицы, что в них лежит и к
// какому разделу они относятся.
//
// Структура читается из самой базы, а разделы — из реестра mcp_section. Поэтому
// новая таблица видна коннектору без правки его кода: с описанием — если ей
// написали COMMENT, в своём разделе — если её имя подошло под строку реестра,
// иначе в разделе «Прочее».

export type Column = { name: string; type: string; comment: string | null };

export type Table = {
    name: string;
    kind: 'table' | 'view';
    comment: string | null;
    rows: number | null;
    columns: Column[];
    /** Колонка первичного ключа, если ключ из одной колонки. */
    pk: string | null;
    section: string;
};

export type Link = { from: string; to: string; title: string };

export type Section = {
    key: string;
    title: string;
    description: string;
    tables: string[];
    prefixes: string[];
    links: Link[];
};

export type Schema = {
    tables: Map<string, Table>;
    sections: Section[];
    /** Все связи: внешние ключи базы и связи из реестра. */
    links: Link[];
};

export const OTHER_SECTION: Section = {
    key: 'other',
    title: 'Прочее',
    description: 'Таблицы, которые ещё не отнесены ни к одному разделу реестра.',
    tables: [],
    prefixes: [],
    links: [],
};

/** Раздел таблицы: точное имя сильнее начала имени, из начал побеждает самое длинное. */
export function sectionOf(table: string, sections: Section[]): string {
    const exact = sections.find((s) => s.tables.includes(table));
    if (exact) return exact.key;

    let best: { key: string; length: number } | null = null;
    for (const s of sections) {
        for (const prefix of s.prefixes) {
            if (prefix && table.startsWith(prefix) && (!best || prefix.length > best.length)) {
                best = { key: s.key, length: prefix.length };
            }
        }
    }
    return best?.key ?? OTHER_SECTION.key;
}

const TTL_MS = 5 * 60_000;
let cached: { at: number; schema: Schema } | null = null;
let loading: Promise<Schema> | null = null;

async function load(): Promise<Schema> {
    const [tableRows, columnRows, pkRows, fkRows, sectionRes] = await Promise.all([
        runSelect<{ name: string; kind: string; comment: string | null; rows: number }>(
            `SELECT c.relname AS name, c.relkind AS kind, obj_description(c.oid) AS comment, c.reltuples::bigint AS rows
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')`,
        ),
        // Колонки приходят по одной строке на таблицу: ответ функции базы ограничен
        // тысячей строк, а колонок в базе больше двух тысяч.
        runSelect<{ tbl: string; cols: Column[] }>(
            `SELECT c.relname AS tbl,
                    jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                                                 'comment', col_description(a.attrelid, a.attnum)) ORDER BY a.attnum) AS cols
               FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') AND a.attnum > 0 AND NOT a.attisdropped
              GROUP BY c.relname`,
        ),
        runSelect<{ tbl: string; col: string }>(
            `SELECT c.relname AS tbl, a.attname AS col
               FROM pg_index i
               JOIN pg_class c ON c.oid = i.indrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
              WHERE n.nspname = 'public' AND i.indisprimary AND i.indnatts = 1`,
        ),
        runSelect<{ from_t: string; from_c: string; to_t: string; to_c: string }>(
            `SELECT cl.relname AS from_t, a.attname AS from_c, fcl.relname AS to_t, fa.attname AS to_c
               FROM pg_constraint k
               JOIN pg_class cl ON cl.oid = k.conrelid
               JOIN pg_namespace n ON n.oid = cl.relnamespace
               JOIN pg_class fcl ON fcl.oid = k.confrelid
               JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
               JOIN pg_attribute fa ON fa.attrelid = k.confrelid AND fa.attnum = k.confkey[1]
              WHERE n.nspname = 'public' AND k.contype = 'f' AND array_length(k.conkey, 1) = 1`,
        ),
        supabase.from('mcp_section').select('key, title, description, tables, prefixes, links').order('ordering'),
    ]);

    if (sectionRes.error) throw new Error(`Реестр разделов не прочитан: ${sectionRes.error.message}`);
    const sections: Section[] = (sectionRes.data ?? []).map((s: any) => ({
        key: String(s.key),
        title: String(s.title),
        description: String(s.description ?? ''),
        tables: Array.isArray(s.tables) ? s.tables : [],
        prefixes: Array.isArray(s.prefixes) ? s.prefixes : [],
        links: Array.isArray(s.links) ? s.links : [],
    }));

    const pk = new Map(pkRows.map((r) => [r.tbl, r.col]));
    const tables = new Map<string, Table>();
    for (const t of tableRows) {
        tables.set(t.name, {
            name: t.name,
            kind: t.kind === 'r' || t.kind === 'p' ? 'table' : 'view',
            comment: t.comment,
            // reltuples = -1 у таблицы, которую база ещё ни разу не считала.
            rows: Number(t.rows) >= 0 ? Number(t.rows) : null,
            columns: [],
            pk: pk.get(t.name) ?? null,
            section: sectionOf(t.name, sections),
        });
    }
    for (const c of columnRows) {
        const table = tables.get(c.tbl);
        if (table) table.columns = c.cols ?? [];
    }

    const links: Link[] = [
        ...fkRows.map((f) => ({ from: `${f.from_t}.${f.from_c}`, to: `${f.to_t}.${f.to_c}`, title: 'Внешний ключ' })),
        ...sections.flatMap((s) => s.links),
    ];

    return { tables, sections: [...sections, OTHER_SECTION], links };
}

/** Карта данных. Держится в памяти пять минут: структура меняется редко, а читать её — пять запросов. */
export async function getSchema(): Promise<Schema> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.schema;
    if (!loading) {
        loading = load()
            .then((schema) => {
                cached = { at: Date.now(), schema };
                return schema;
            })
            .finally(() => {
                loading = null;
            });
    }
    return loading;
}

/** Таблица по имени или внятная ошибка с подсказкой, где искать. */
export function requireTable(schema: Schema, name: string): Table {
    const table = schema.tables.get(String(name ?? '').trim().replace(/^public\./i, ''));
    if (!table) throw new Error(`Таблицы «${name}» в ОКК нет. Список — в list_sections, поиск по слову — в schema_lookup.`);
    return table;
}

export function requireColumn(table: Table, name: string): Column {
    const column = table.columns.find((c) => c.name === name);
    if (!column) {
        throw new Error(`В таблице «${table.name}» нет поля «${name}». Поля: ${table.columns.map((c) => c.name).join(', ')}.`);
    }
    return column;
}

/** Связи, в которых участвует таблица, — в обе стороны. */
export function linksOf(schema: Schema, table: string): Link[] {
    return schema.links.filter((l) => l.from.startsWith(`${table}.`) || l.to.startsWith(`${table}.`));
}
