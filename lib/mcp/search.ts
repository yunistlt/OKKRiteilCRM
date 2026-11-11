import { ident, lit, runSelect } from '@/lib/mcp/sql';
import { getSchema } from '@/lib/mcp/schema';

// Поиск по словам сразу в нескольких разделах.
//
// Ищем только там, где это дёшево: по коротким полям и по готовой поисковой
// колонке заказа с индексом. Расшифровки звонков и тела писем сюда не входят —
// перебор десятков тысяч длинных текстов на каждый вопрос базе не по силам; для
// них есть run_query с условием по периоду.

type Target = {
    table: string;
    /** Поля, в которых ищем. */
    columns: string[];
    /** Поле-заголовок найденного объекта. */
    title: string;
    /** Поле даты — для периода и сортировки «свежее выше». */
    date?: string;
};

export const SEARCH_TARGETS: Target[] = [
    { table: 'orders', columns: ['search_text'], title: 'number', date: 'created_at' },
    { table: 'clients', columns: ['company_name', 'full_name', 'inn', 'email', 'contact_name'], title: 'company_name', date: 'created_at' },
    { table: 'managers', columns: ['first_name', 'last_name', 'email'], title: 'last_name' },
    { table: 'incoming_emails', columns: ['subject', 'from_email', 'from_name'], title: 'subject', date: 'received_at' },
    { table: 'order_files', columns: ['file_name'], title: 'file_name', date: 'created_at' },
    { table: 'legal_matters', columns: ['matter_no', 'counterparty_name', 'counterparty_inn', 'subject'], title: 'counterparty_name', date: 'created_at' },
    { table: 'legal_enforcement_cases', columns: ['debtor_name', 'debtor_inn', 'case_number'], title: 'debtor_name', date: 'created_at' },
    { table: 'court_cases', columns: ['case_number', 'plaintiff', 'defendant'], title: 'case_number', date: 'registered_on' },
    { table: 'improvements', columns: ['text', 'section'], title: 'text', date: 'created_at' },
];

const PER_TABLE = 10;

/** Кусок текста вокруг найденного слова. */
export function fragment(text: string, query: string, radius = 120): string {
    const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
    const at = flat.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return flat.slice(0, radius * 2);
    const start = Math.max(0, at - radius);
    const end = Math.min(flat.length, at + query.length + radius);
    return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export type SearchArgs = { query: string; section?: string; type?: string; from?: string; to?: string; closedSections?: string[] };

export async function searchEverywhere(args: SearchArgs) {
    const query = String(args.query ?? '').trim();
    if (query.length < 2) throw new Error('Строка поиска короче двух знаков.');

    const schema = await getSchema();
    const closed = new Set(args.closedSections ?? []);

    const targets = SEARCH_TARGETS.filter((t) => {
        const table = schema.tables.get(t.table);
        if (!table || closed.has(table.section)) return false;
        if (args.type && args.type !== t.table) return false;
        if (args.section && args.section !== table.section) return false;
        return true;
    });
    if (targets.length === 0) {
        throw new Error(
            `Поиск по словам здесь не настроен. Он работает по таблицам: ${SEARCH_TARGETS.map((t) => t.table).join(', ')}. Для остального — list_entities с фильтром like или run_query.`,
        );
    }

    const pattern = lit(`%${query.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`);
    const results: Array<{ type: string; id: unknown; title: string; fragment: string; date: unknown }> = [];

    // По очереди, а не разом: девять одновременных запросов — лишняя нагрузка на базу.
    for (const t of targets) {
        const table = schema.tables.get(t.table)!;
        const has = (name: string) => table.columns.some((c) => c.name === name);
        const columns = t.columns.filter(has);
        if (columns.length === 0) continue;

        const where = [`(${columns.map((c) => `${ident(c)} ILIKE ${pattern}`).join(' OR ')})`];
        if (t.date && has(t.date)) {
            if (args.from) where.push(`${ident(t.date)} >= ${lit(args.from)}`);
            if (args.to) where.push(`${ident(t.date)} < ${lit(args.to)}`);
        }
        const haystack = columns.map((c) => `coalesce(${ident(c)}::text, '')`).join(` || ' · ' || `);
        const idExpr = table.pk ? ident(table.pk) : 'NULL';
        const dateExpr = t.date && has(t.date) ? ident(t.date) : 'NULL';
        const order = t.date && has(t.date) ? `ORDER BY ${ident(t.date)} DESC NULLS LAST` : '';

        const rows = await runSelect<{ id: unknown; title: string | null; hay: string; date: unknown }>(
            `SELECT ${idExpr} AS id, ${has(t.title) ? `${ident(t.title)}::text` : 'NULL'} AS title, left(${haystack}, 4000) AS hay, ${dateExpr} AS date
               FROM public.${ident(t.table)} WHERE ${where.join(' AND ')} ${order} LIMIT ${PER_TABLE}`,
        );
        for (const r of rows) {
            results.push({
                type: t.table,
                id: r.id,
                title: String(r.title ?? '').slice(0, 200),
                fragment: fragment(r.hay, query),
                date: r.date,
            });
        }
    }

    return {
        query,
        searched: targets.map((t) => t.table),
        results,
        count: results.length,
        note: `До ${PER_TABLE} самых свежих совпадений на таблицу. Карточка — get_entity(type, id).`,
    };
}
