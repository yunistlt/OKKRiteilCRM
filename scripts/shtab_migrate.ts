/**
 * Применяет миграцию Штаба к базе из .env.local.
 *
 *   npm run shtab:migrate
 *
 * Раннера миграций в проекте нет, а просить владельца открывать SQL-консоль
 * ради одного файла — лишний шаг там, где легко ошибиться. Миграция аддитивная
 * и идемпотентная: повторный запуск ничего не ломает и не плодит дубли.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });

// Имя файла аргументом, с прежним значением по умолчанию: миграций Штаба уже
// несколько, а раннера в проекте нет — каждый раз править константу значит
// однажды применить не ту.
const MIGRATION = process.argv[2] || '20260825_shtab_owner_hq.sql';

async function main() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error('Не задан DATABASE_URL (или POSTGRES_URL) в .env.local');
        process.exit(1);
    }

    const file = path.join(process.cwd(), 'migrations', MIGRATION);
    const sql = readFileSync(file, 'utf8');

    const client = new Client({ connectionString });
    await client.connect();
    try {
        console.log(`Применяю ${MIGRATION}…`);
        await client.query(sql);

        // Отчёт по факту, а не по намерению: видно, что реально встало в базу.
        const { rows } = await client.query<{ areas: string; minuses: string; open: string; goals: string }>(`
            SELECT (SELECT count(*) FROM public.shtab_area)                  AS areas,
                   (SELECT count(*) FROM public.shtab_minus)                 AS minuses,
                   (SELECT count(*) FROM public.shtab_minus WHERE NOT done)  AS open,
                   (SELECT count(*) FROM public.shtab_goal)                  AS goals
        `);
        const r = rows[0];
        console.log('Готово.');
        console.log(`  областей: ${r.areas}`);
        console.log(`  минусов: ${r.minuses} (открытых ${r.open})`);
        console.log(`  целей: ${r.goals}`);

        const { rows: byArea } = await client.query<{ title: string; n: string }>(`
            SELECT a.title, count(m.id) FILTER (WHERE NOT m.done) AS n
              FROM public.shtab_area a
              LEFT JOIN public.shtab_minus m ON m.area_code = a.code
             GROUP BY a.title, a.ordinal
             ORDER BY count(m.id) FILTER (WHERE NOT m.done) DESC, a.ordinal
             LIMIT 3
        `);
        if (byArea.length > 0) {
            console.log(`  приоритет: ${byArea.map((x) => `${x.title} — ${x.n}`).join(', ')}`);
        }
    } finally {
        await client.end();
    }
}

main().catch((e) => {
    console.error('Миграция не применилась:', e instanceof Error ? e.message : e);
    process.exit(1);
});
