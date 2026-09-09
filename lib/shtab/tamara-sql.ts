import { supabase } from '@/utils/supabase';
import { assertReadOnlyQuery } from '@/lib/shtab/external/client';

// Право Тамары задать данным вопрос, которого никто не предусмотрел.
//
// До этого инструмента она умела ровно шесть заранее написанных запросов. Этого
// хватает, чтобы отвечать, и не хватает, чтобы РАЗБИРАТЬСЯ: настоящий анализ —
// это цепочка «увидел странное число → проверил догадку → увидел ещё более
// странное». Каждый следующий запрос зависит от предыдущего ответа, и заранее
// его не напишешь.
//
// Цена такой свободы — риск. Поэтому рубежей четыре:
//
//   1. Список таблиц. Модель видит только то, что перечислено здесь; персональные
//      данные, переписка и чужие подсистемы недоступны в принципе.
//   2. Проверка текста запроса — тот же assertReadOnlyQuery, что стоит перед
//      боевыми базами группы: один оператор, только SELECT, без записи файлов и
//      блокировок.
//   3. Жёсткий LIMIT и таймаут: аналитический запрос не должен положить базу,
//      на которой работает вся компания.
//   4. Журнал. Каждый запрос модели пишется в shtab_query_log — по нему видно,
//      что она спрашивала и что получила, и это единственный способ понять,
//      откуда взялся вывод.

/**
 * Что Тамаре можно читать.
 *
 * Список белый, а не чёрный: новая таблица в проекте не должна становиться
 * доступной сама собой. Здесь только то, из чего состоит управленческая
 * картина, — заказы, статусы, деньги, работа отдела продаж и её собственные
 * таблицы Штаба.
 */
export const ALLOWED_RELATIONS = [
    'orders',
    'statuses',
    'managers',
    'order_history_log',
    'point_payments',
    'retailcrm_dictionaries',
    'retailcrm_custom_fields',
    'okk_order_scores',
    'sales_client_purchases_mv',
    'sales_client_profile_mv',
    'sales_sphere_category_mv',
    'sales_rop_task',
    'sales_rop_queue',
    'sales_category_rule',
    'shtab_area',
    'shtab_minus',
    'shtab_razbor',
    'shtab_goal',
    'shtab_project',
    'shtab_post',
    'shtab_block',
    'shtab_program',
    'shtab_task',
] as const;

const MAX_LIMIT = 200;

/** Имена отношений, встречающиеся в запросе после FROM и JOIN. */
export function referencedRelations(query: string): string[] {
    const cleaned = query
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/'(?:[^']|'')*'/g, " '' ");
    const names = new Set<string>();
    const re = /\b(?:from|join)\s+([a-zA-Z_][\w.]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
        names.add(m[1].replace(/^public\./i, '').toLowerCase());
    }
    return Array.from(names);
}

/** Имена, объявленные в WITH: это не таблицы, а временные названия внутри запроса. */
export function cteNames(query: string): string[] {
    const names = new Set<string>();
    const re = /\b([a-zA-Z_]\w*)\s+as\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) names.add(m[1].toLowerCase());
    return Array.from(names);
}

export function assertAllowedQuery(query: string): void {
    assertReadOnlyQuery(query, 'postgres');

    const allowed = new Set<string>(ALLOWED_RELATIONS as readonly string[]);
    const cte = new Set(cteNames(query));

    for (const name of referencedRelations(query)) {
        if (cte.has(name)) continue;
        // Подзапрос «FROM (SELECT …)» имени не имеет — скобка сюда не попадает.
        if (name.startsWith('(')) continue;
        if (!allowed.has(name)) {
            throw new Error(
                `Таблица «${name}» Тамаре недоступна. Доступны: ${Array.from(allowed).join(', ')}`,
            );
        }
    }
}

/** Дописывает LIMIT, если его нет: ответ на сто тысяч строк бесполезен обоим. */
export function withLimit(query: string, limit = MAX_LIMIT): string {
    const body = query.trim().replace(/;\s*$/, '');
    return /\blimit\s+\d+\s*$/i.test(body) ? body : `${body} LIMIT ${limit}`;
}

export type QueryResult = { rows: any[]; rowCount: number; sql: string; note?: string };

/**
 * Выполняет SELECT от имени Тамары и пишет его в журнал.
 *
 * Ошибка возвращается текстом, а не бросается: модель должна увидеть, что
 * запрос неверный, и переписать его — это и есть работа аналитика.
 */
export async function runTamaraQuery(query: string, purpose: string): Promise<QueryResult | { error: string }> {
    let prepared: string;
    try {
        assertAllowedQuery(query);
        prepared = withLimit(query);
    } catch (e: any) {
        await logQuery(query, purpose, 0, e.message);
        return { error: e.message };
    }

    const { data, error } = await supabase.rpc('shtab_run_readonly_query', { p_sql: prepared });
    if (error) {
        await logQuery(prepared, purpose, 0, error.message);
        return { error: `Запрос не выполнился: ${error.message}` };
    }

    const rows = (data ?? []) as any[];
    await logQuery(prepared, purpose, rows.length, null);

    return {
        rows,
        rowCount: rows.length,
        sql: prepared,
        note:
            rows.length >= MAX_LIMIT
                ? `Показаны первые ${MAX_LIMIT} строк — если нужен итог, посчитай его в самом запросе (sum, count, group by)`
                : undefined,
    };
}

async function logQuery(sql: string, purpose: string, rowCount: number, error: string | null): Promise<void> {
    await supabase
        .from('shtab_query_log')
        .insert({ sql, purpose, row_count: rowCount, error })
        .then(() => null, () => null);
}
