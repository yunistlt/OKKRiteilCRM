// Применение индекса истории заказов + замер presale_orders до/после.
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
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 60 });

const buffers = async () => {
    const plan = await sql.unsafe(`explain (analyze, buffers) select * from sales_rop_presale_orders()`);
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    return {
        buf: Number(/Buffers: shared hit=(\d+)/.exec(text)?.[1] ?? 0),
        ms: Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1] ?? 0),
    };
};

console.log('до :', JSON.stringify(await buffers()));
await sql.unsafe(fs.readFileSync(path.join(root, 'migrations/20260902_history_order_time_index.sql'), 'utf8'));
console.log('индекс создан');
await sql.unsafe('analyze public.order_history_log');
console.log('после:', JSON.stringify(await buffers()));

await sql.end();
