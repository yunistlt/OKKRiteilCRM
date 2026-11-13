import { supabase } from '@/utils/supabase';
import { assertReadOnlyQuery } from '@/lib/shtab/external/guard';
import { cteNames, referencedRelations } from '@/lib/shtab/tamara-sql';

// Чтение базы для коннектора Claude.
//
// Свой путь к данным не заводим: запрос уходит в ту же функцию базы, что и у
// Тамары, — shtab_run_readonly_query. Она открывает транзакцию без права записи
// и ставит таймаут, так что даже проскочивший проверку текста оператор записи
// база не выполнит. Проверка текста здесь — второй рубеж и внятная ошибка.

/** Больше строк Claude за один ответ не нужно — итоги считаются в самом запросе. */
export const MAX_QUERY_ROWS = 1000;

/** Потолок размера одного ответа: дальше — пагинация или более узкий запрос. */
export const MAX_RESPONSE_BYTES = 50_000;

/** Одновременно в базу от коннектора идёт не больше двух запросов: диск у базы слабый. */
const MAX_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
        return await work();
    } finally {
        running -= 1;
        waiting.shift()?.();
    }
}

/** Человеческий текст вместо ошибки драйвера. */
function explain(message: string): string {
    if (/statement timeout|canceling statement/i.test(message)) {
        return 'Запрос превысил таймаут. Сузь период или посчитай итог в самом запросе (sum, count, group by).';
    }
    if (/read-only transaction/i.test(message)) return 'Коннектор работает только на чтение: запись запрещена.';
    return `Запрос не выполнился: ${message}`;
}

/** Выполняет готовый SELECT. Для запросов, которые пишет код, а не Claude. */
export async function runSelect<T = Record<string, any>>(sql: string, limit?: number): Promise<T[]> {
    const body = sql.trim().replace(/;\s*$/, '');
    const query = limit ? `SELECT * FROM (${body}) AS mcp_q LIMIT ${limit}` : body;
    return withSlot(async () => {
        const { data, error } = await supabase.rpc('shtab_run_readonly_query', { p_sql: query });
        if (error) throw new Error(explain(String(error.message ?? error)));
        return (data ?? []) as T[];
    });
}

/**
 * Проверка запроса, который написал Claude.
 *
 * Читать можно только нашу схему public и описание структуры (две таблицы
 * information_schema). Служебные таблицы самой базы и чужие схемы закрыты:
 * там учётки платформы, файлы и секреты, а не данные ОКК.
 */
export function assertQueryAllowed(query: string): void {
    try {
        assertReadOnlyQuery(query, 'postgres');
    } catch (e: any) {
        throw new Error(String(e?.message ?? e).replace(/Во внешн(юю|ей) баз[уе]\s*/i, '').replace(/^разрешён/, 'Разрешён'));
    }

    const cte = new Set(cteNames(query));
    for (const name of referencedRelations(query)) {
        if (cte.has(name) || name.startsWith('(')) continue;
        if (name === 'information_schema.columns' || name === 'information_schema.tables') continue;
        if (name.includes('.') || name.startsWith('pg_')) {
            throw new Error(`Читать можно только таблицы ОКК (схема public), а «${name}» — служебная таблица базы.`);
        }
    }
}

export type QueryAnswer = { rows: Record<string, any>[]; row_count: number; truncated: boolean; note?: string };

/** Обрезает набор строк по потолку размера ответа. */
export function fitRows(rows: Record<string, any>[], maxBytes = MAX_RESPONSE_BYTES): { rows: Record<string, any>[]; cut: boolean } {
    let size = 2;
    const kept: Record<string, any>[] = [];
    for (const row of rows) {
        size += JSON.stringify(row).length + 1;
        if (size > maxBytes && kept.length > 0) return { rows: kept, cut: true };
        kept.push(row);
    }
    return { rows: kept, cut: false };
}

/** Произвольный SELECT от Claude: проверка, потолок строк, потолок размера. */
export async function runUserQuery(query: string): Promise<QueryAnswer> {
    assertQueryAllowed(query);
    const rows = await runSelect(query, MAX_QUERY_ROWS + 1);

    const overLimit = rows.length > MAX_QUERY_ROWS;
    const fitted = fitRows(overLimit ? rows.slice(0, MAX_QUERY_ROWS) : rows);
    const truncated = overLimit || fitted.cut;

    return {
        rows: fitted.rows,
        row_count: fitted.rows.length,
        truncated,
        note: truncated
            ? `Показаны первые ${fitted.rows.length} строк. Если нужен итог — посчитай его в запросе (sum, count, group by), если строки — добавь условие или OFFSET.`
            : undefined,
    };
}

/** Литерал для запросов, которые собирает код: одинарные кавычки удваиваются. */
export function lit(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/** Имя таблицы или колонки в кавычках — в базе есть имена с заглавными буквами. */
export function ident(name: string): string {
    return `"${String(name).replace(/"/g, '""')}"`;
}
