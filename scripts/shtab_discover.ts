/**
 * Снимает структуру внешних баз группы — ЦехУспех, КБ, маркетинг.
 *
 *   npm run shtab:discover
 *
 * Зачем. Написать инструменты Тамары к базе, схему которой я не видел, нельзя:
 * запрос по догадке даёт правдоподобное и непроверяемое число, а владелец по
 * словам Тамары принимает решения. Скрипт снимает только СТРУКТУРУ — таблицы,
 * колонки, типы, связи и порядок числа строк. Данные не выгружаются: ни одной
 * строки из таблиц наружу не уходит.
 *
 * Результат ложится в docs/shtab/schemas/*.md, его можно коммитить.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { closeExternal, EXTERNAL_DB_TITLES, externalDbConfigured, queryExternal } from '../lib/shtab/external/client';
import type { ExternalDb } from '../lib/shtab/external/client';

config({ path: '.env.local' });

const DBS: ExternalDb[] = ['tseh', 'kb', 'marketing'];
const OUT_DIR = path.join(process.cwd(), 'docs', 'shtab', 'schemas');

type ColumnRow = {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
};
type FkRow = { table_name: string; column_name: string; foreign_table: string; foreign_column: string };
type SizeRow = { table_name: string; approx_rows: string };

const COLUMNS_SQL = `
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position
`;

// Связи берём из pg_catalog, а не из information_schema. Причина проверена на
// живой базе: constraint_column_usage показывает только таблицы, которыми роль
// владеет, поэтому роли «только чтение» она возвращает пустоту — и снимок
// молча лишался бы всех связей, то есть ровно того, ради чего он снимается.
const FK_SQL = `
    SELECT c.relname   AS table_name,
           a.attname   AS column_name,
           fc.relname  AS foreign_table,
           fa.attname  AS foreign_column
      FROM pg_constraint con
      JOIN pg_class c     ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class fc    ON fc.oid = con.confrelid
      JOIN unnest(con.conkey)  WITH ORDINALITY AS k(attnum, ord)  ON true
      JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
      JOIN pg_attribute a  ON a.attrelid = c.oid   AND a.attnum = k.attnum
      JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = fk.attnum
     WHERE con.contype = 'f' AND n.nspname = 'public'
     ORDER BY c.relname, k.ord
`

// Оценка из планировщика, а не COUNT(*): точное число тут не нужно, а полный
// проход по чужой боевой базе — лишняя нагрузка.
const SIZE_SQL = `
    SELECT relname AS table_name, reltuples::bigint::text AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY relname
`;

function renderMarkdown(db: ExternalDb, columns: ColumnRow[], fks: FkRow[], sizes: SizeRow[]): string {
    const byTable = new Map<string, ColumnRow[]>();
    for (const c of columns) {
        const list = byTable.get(c.table_name) ?? [];
        list.push(c);
        byTable.set(c.table_name, list);
    }
    const fkByTable = new Map<string, FkRow[]>();
    for (const f of fks) {
        const list = fkByTable.get(f.table_name) ?? [];
        list.push(f);
        fkByTable.set(f.table_name, list);
    }
    const rowsByTable = new Map(sizes.map((s) => [s.table_name, s.approx_rows]));

    const lines: string[] = [
        `# Схема базы «${EXTERNAL_DB_TITLES[db]}»`,
        '',
        'Снято скриптом `npm run shtab:discover`. Только структура — данные не выгружались.',
        `Таблиц: ${byTable.size}.`,
        '',
    ];

    // pg_class перечисляет все таблицы, а information_schema.columns — только те,
    // на которые у роли есть права. Разница означает, что GRANT SELECT выдан не
    // на всё: без этой строчки таблица выглядела бы просто отсутствующей.
    const unreadable = sizes.map((s) => s.table_name).filter((t) => !byTable.has(t));
    if (unreadable.length > 0) {
        lines.push(
            `> Ещё ${unreadable.length} таблиц(ы) есть в базе, но роли не выданы права на чтение: ` +
                unreadable.join(', ') +
                '. Если они нужны Тамаре — добавьте GRANT SELECT и снимите схему заново.',
            '',
        );
    }

    for (const [table, cols] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const approx = rowsByTable.get(table);
        lines.push(`## ${table}${approx ? ` — примерно ${Number(approx).toLocaleString('ru-RU')} строк` : ''}`);
        lines.push('');
        lines.push('| Колонка | Тип | NULL | По умолчанию |');
        lines.push('|---|---|---|---|');
        for (const c of cols) {
            const def = c.column_default ? `\`${c.column_default.slice(0, 40)}\`` : '';
            lines.push(`| ${c.column_name} | ${c.data_type} | ${c.is_nullable === 'YES' ? 'да' : 'нет'} | ${def} |`);
        }
        const tableFks = fkByTable.get(table) ?? [];
        if (tableFks.length > 0) {
            lines.push('');
            lines.push('Связи: ' + tableFks.map((f) => `${f.column_name} → ${f.foreign_table}.${f.foreign_column}`).join(', '));
        }
        lines.push('');
    }
    return lines.join('\n');
}

async function main() {
    mkdirSync(OUT_DIR, { recursive: true });
    let done = 0;

    for (const db of DBS) {
        const title = EXTERNAL_DB_TITLES[db];
        if (!externalDbConfigured(db)) {
            console.log(`— ${title}: пропускаю, строка подключения не задана`);
            continue;
        }
        try {
            console.log(`— ${title}: подключаюсь…`);
            const [columns, fks, sizes] = await Promise.all([
                queryExternal<ColumnRow>(db, COLUMNS_SQL),
                queryExternal<FkRow>(db, FK_SQL),
                queryExternal<SizeRow>(db, SIZE_SQL),
            ]);
            const file = path.join(OUT_DIR, `${db}.md`);
            writeFileSync(file, renderMarkdown(db, columns, fks, sizes), 'utf8');
            const tables = new Set(columns.map((c) => c.table_name)).size;
            const hidden = sizes.filter((s) => !columns.some((c) => c.table_name === s.table_name)).length;
            console.log(
                `  таблиц ${tables}, колонок ${columns.length}, связей ${fks.length} → ${path.relative(process.cwd(), file)}` +
                    (hidden > 0 ? `\n  внимание: ещё ${hidden} таблиц(ы) без прав на чтение — см. пометку в файле` : ''),
            );
            done += 1;
        } catch (e) {
            console.error(`  не удалось: ${e instanceof Error ? e.message : e}`);
        }
    }

    await closeExternal();
    if (done === 0) {
        console.log('\nНи одна база не снята. Проверь SHTAB_DB_TSEH_URL / SHTAB_DB_KB_URL / SHTAB_DB_MARKETING_URL в .env.local');
        process.exit(1);
    }
    console.log(`\nГотово: снято баз ${done}. Схемы лежат в docs/shtab/schemas/ — их можно коммитить.`);
}

main().catch((e) => {
    console.error('Сбой:', e instanceof Error ? e.message : e);
    process.exit(1);
});
