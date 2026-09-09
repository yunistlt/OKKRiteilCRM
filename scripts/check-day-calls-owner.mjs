// Только чтение: как новая sales_rop_day_calls склеивает ноги и кто владелец заказа.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const fs = require('fs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.DATABASE_URL = fs
    .readFileSync(path.join(root, '.env.local'), 'utf8')
    .match(/^DATABASE_URL=(.*)$/m)[1]
    .replace(/^"|"$/g, '');

const postgres = (await import('postgres')).default;
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20 });
const day = process.argv[2] || '2026-09-02';

console.log('колонки managers:');
console.log(
    (await sql`select column_name from information_schema.columns where table_name='managers'`)
        .map((r) => r.column_name)
        .join(','),
);

const body = fs
    .readFileSync(path.join(root, 'migrations/20260902_day_calls_owner.sql'), 'utf8')
    .split('LANGUAGE sql STABLE AS $function$')[1]
    .split('$function$')[0]
    .trim()
    .replace(/;\s*$/, '');

for (const m of ['10', '98', '249']) {
    const q = body.replaceAll('p_date', `'${day}'::date`).replaceAll('p_manager', `'${m}'`);
    const t = Date.now();
    const r = await sql.unsafe(
        `select * from (${q}) x(call_at, direction, duration_sec, phone, order_number, order_manager_name, transcript)`,
    );
    const old = await sql.unsafe(`select count(*) c from sales_rop_day_calls('${day}','${m}')`);
    console.log(`\nменеджер ${m}: было ${old[0].c} строк, стало ${r.length}  (${((Date.now() - t) / 1000).toFixed(2)}s)`);
    console.table(
        r
            .filter((x) => x.order_number)
            .slice(0, 6)
            .map((x) => ({
                время: String(x.call_at).slice(11, 16),
                тип: x.direction,
                сек: x.duration_sec,
                заказ: x.order_number,
                'заказ у': x.order_manager_name,
            })),
    );
}

await sql.end();
