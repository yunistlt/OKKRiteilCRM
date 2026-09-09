// Только чтение: полные выборки всех запросов вечернего прогона, с временем.
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
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 10 });
const day = process.argv[2] || new Date().toISOString().slice(0, 10);

async function step(name, q) {
    const t = Date.now();
    try {
        const r = await sql.unsafe(q);
        console.log(`${((Date.now() - t) / 1000).toFixed(2)}s  ${name}  строк ${r.length}`);
        return r;
    } catch (e) {
        console.log(`${((Date.now() - t) / 1000).toFixed(2)}s  ${name}  ОШИБКА ${e.message.slice(0, 120)}`);
        return [];
    }
}

console.log('день', day);
await step('sales_rop_task select', `select * from sales_rop_task where plan_date = '${day}'`);
await step('sales_rop_touches', `select * from sales_rop_touches('${day}')`);
await step('sales_rop_presale_orders', `select * from sales_rop_presale_orders()`);
await step('sales_rop_day_facts', `select * from sales_rop_day_facts('${day}')`);
await step('sales_rop_call_day', `select * from sales_rop_call_day('${day}')`);
await step('sales_rop_call_baseline', `select * from sales_rop_call_baseline(14)`);

const mgrs = await sql.unsafe(
    `select distinct manager_id from sales_rop_task where plan_date = '${day}' and manager_id is not null`,
);
for (const m of mgrs) {
    await step(`sales_rop_day_calls(${m.manager_id})`, `select * from sales_rop_day_calls('${day}','${m.manager_id}')`);
}

await sql.end();
