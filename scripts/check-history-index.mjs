// Только чтение: индексы order_history_log и план presale_orders.
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

console.log('индексы order_history_log:');
console.log((await sql`select indexname, indexdef from pg_indexes where tablename='order_history_log'`)
    .map((r) => '  ' + r.indexdef).join('\n'));

console.log('\nстрок в order_history_log:', (await sql`select count(*) c from order_history_log`)[0].c);

console.log('\nплан sales_rop_presale_orders:');
const plan = await sql.unsafe(`explain (analyze, buffers) select * from sales_rop_presale_orders()`);
console.log(plan.map((r) => '  ' + r['QUERY PLAN']).join('\n').slice(0, 2500));

await sql.end();
