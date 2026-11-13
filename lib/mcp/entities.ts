import { fitRows, ident, lit, runSelect } from '@/lib/mcp/sql';
import { getSchema, linksOf, requireColumn, requireTable } from '@/lib/mcp/schema';
import type { Column, Table } from '@/lib/mcp/schema';

// Универсальное чтение: список объектов любой таблицы и карточка одного объекта.
//
// Запрос собирает код из проверенных частей: имя таблицы и поля сверяются с
// картой данных, значения уходят литералами с экранированием. Свободного текста
// от Claude в запросе нет — для него есть отдельный run_query.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** В списке длинный текст режется: полное значение — в карточке объекта. */
const LIST_TEXT_CUT = 300;

export type Filter = { field: string; op?: string; value?: unknown };
export type Period = { field: string; from?: string; to?: string };
export type Sort = { field: string; dir?: string };

const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const isHeavy = (c: Column) => /^(jsonb?|bytea|vector|tsvector)/i.test(c.type) || /^vector/i.test(c.type);
// Массивы (text[]) текстом не считаем: функция left к ним неприменима.
const isText = (c: Column) => /^(text|character varying|character|varchar)(\(\d+\))?$/i.test(c.type);

// Число тоже уходит в кавычках: база сама приведёт его к типу колонки, а голое
// число против текстового поля (номер заказа) дало бы ошибку сравнения.
function literal(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return lit(String(value));
}

/** Условие по одному полю. Сравнение идёт в типе самой колонки — литерал база приводит сама. */
export function filterSql(table: Table, f: Filter): string {
    const column = requireColumn(table, String(f.field));
    const col = ident(column.name);
    const op = String(f.op ?? 'eq').toLowerCase();

    if (op === 'is_null') return `${col} IS NULL`;
    if (op === 'not_null') return `${col} IS NOT NULL`;
    if (op === 'like' || op === 'ilike') return `${col}::text ILIKE ${lit(`%${String(f.value ?? '')}%`)}`;
    if (op === 'in') {
        const values = Array.isArray(f.value) ? f.value : [f.value];
        if (values.length === 0) return 'FALSE';
        return `${col} IN (${values.map(literal).join(', ')})`;
    }
    const sign = OPS[op];
    if (!sign) throw new Error(`Неизвестное сравнение «${op}». Доступны: eq, neq, gt, gte, lt, lte, like, in, is_null, not_null.`);
    if (f.value === null || f.value === undefined) throw new Error(`Для поля «${column.name}» не задано значение. Пустоту проверяй сравнением is_null.`);
    return `${col} ${sign} ${literal(f.value)}`;
}

export function whereSql(table: Table, filters: Filter[] = [], period?: Period | null): string {
    const parts = filters.map((f) => filterSql(table, f));
    if (period?.field) {
        const col = ident(requireColumn(table, period.field).name);
        if (period.from) parts.push(`${col} >= ${lit(period.from)}`);
        if (period.to) parts.push(`${col} < ${lit(period.to)}`);
    }
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

/** Сдвиг от начала списка. Курсор — обычное число строкой: так его видно в журнале. */
export function offsetOf(cursor?: string | null): number {
    const n = Number(cursor ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

export function limitOf(limit?: number | null): number {
    const n = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
}

export type ListArgs = {
    type: string;
    filters?: Filter[];
    period?: Period | null;
    sort?: Sort | null;
    fields?: string[];
    limit?: number;
    cursor?: string;
};

export async function listEntities(args: ListArgs) {
    const schema = await getSchema();
    const table = requireTable(schema, args.type);

    // Без явного списка полей тяжёлые колонки (JSON, векторы) в список не идут:
    // одна строка заказа с сырым ответом CRM весит больше всего ответа.
    const columns = args.fields?.length
        ? args.fields.map((name) => requireColumn(table, name))
        : table.columns.filter((c) => !isHeavy(c));
    const skipped = args.fields?.length ? [] : table.columns.filter(isHeavy).map((c) => c.name);

    const select = columns
        .map((c) => (isText(c) && !args.fields?.length ? `left(${ident(c.name)}, ${LIST_TEXT_CUT}) AS ${ident(c.name)}` : ident(c.name)))
        .join(', ');

    const sortField = args.sort?.field ? requireColumn(table, args.sort.field).name : table.pk;
    const dir = String(args.sort?.dir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    // По ключу сортируем без NULLS LAST: пустых значений там нет, а с этой
    // припиской база не может идти по индексу ключа и перебирает таблицу целиком
    // (на orders это 8 секунд вместо миллисекунд).
    const nulls = sortField === table.pk ? '' : ' NULLS LAST';
    const order = sortField ? `ORDER BY ${ident(sortField)} ${dir}${nulls}` : '';

    const limit = limitOf(args.limit);
    const offset = offsetOf(args.cursor);

    const rows = await runSelect(
        `SELECT ${select} FROM public.${ident(table.name)} ${whereSql(table, args.filters, args.period)} ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    );

    // Пустые поля из списка убираем: у заказа полторы сотни колонок, и почти все
    // пусты — без этого три заказа занимают место тридцати.
    const page = rows.slice(0, limit).map((row) => {
        const lean: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) if (v !== null && v !== '') lean[k] = v;
        return lean;
    });
    const fitted = fitRows(page);
    const more = rows.length > limit || fitted.cut;

    return {
        type: table.name,
        items: fitted.rows,
        count: fitted.rows.length,
        next_cursor: more ? String(offset + fitted.rows.length) : null,
        note: skipped.length
            ? `Тяжёлые поля в список не включены: ${skipped.join(', ')}. Они есть в get_entity; в списке — через параметр fields. Текст длиннее ${LIST_TEXT_CUT} знаков обрезан, пустые поля опущены.`
            : 'Пустые поля опущены.',
    };
}

/** Карточка объекта: все поля и подсказки, где лежит связанное. */
export async function getEntity(type: string, id: string | number) {
    const schema = await getSchema();
    const table = requireTable(schema, type);
    if (!table.pk) {
        throw new Error(`У «${table.name}» нет ключа из одного поля — карточку по id не открыть. Возьми строку через list_entities с фильтром.`);
    }

    const columns = table.columns.filter((c) => !/^vector/i.test(c.type));
    const rows = await runSelect(
        `SELECT ${columns.map((c) => ident(c.name)).join(', ')} FROM public.${ident(table.name)} WHERE ${ident(table.pk)} = ${literal(id)} LIMIT 1`,
    );
    if (rows.length === 0) throw new Error(`Объект «${table.name}» с ${table.pk} = ${id} не найден.`);

    const row = rows[0];
    const cut: string[] = [];
    // Карточка тоже обязана уложиться в потолок ответа: самые длинные поля режем
    // по очереди и честно говорим, какие.
    const sizeOf = () => JSON.stringify(row).length;
    while (sizeOf() > 45_000) {
        const longest = Object.keys(row)
            .map((k) => ({ k, n: JSON.stringify(row[k] ?? null).length }))
            .sort((a, b) => b.n - a.n)[0];
        if (!longest || longest.n < 2_000) break;
        const text = typeof row[longest.k] === 'string' ? row[longest.k] : JSON.stringify(row[longest.k]);
        row[longest.k] = `${text.slice(0, Math.max(1_000, Math.floor(longest.n / 3)))}… [обрезано]`;
        if (!cut.includes(longest.k)) cut.push(longest.k);
    }

    const related = linksOf(schema, table.name).map((l) => {
        const [fromTable, fromColumn] = l.from.split('.');
        const [toTable, toColumn] = l.to.split('.');
        const outward = fromTable === table.name;
        const other = outward ? toTable : fromTable;
        const otherColumn = outward ? toColumn : fromColumn;
        const value = row[outward ? fromColumn : toColumn];
        return {
            title: l.title,
            type: other,
            // Готовые параметры для list_entities — чтобы связанное открывалось одним вызовом.
            filters: [{ field: otherColumn, op: 'eq', value }],
        };
    }).filter((r) => r.filters[0].value !== null && r.filters[0].value !== undefined);

    return {
        type: table.name,
        id: row[table.pk],
        fields: row,
        related,
        note: cut.length ? `Поля обрезаны по размеру: ${cut.join(', ')}. Целиком — через run_query с substr().` : undefined,
    };
}
