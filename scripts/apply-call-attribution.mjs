// Применение миграций атрибуции звонков + проверка на инциденте с заказом 54494.
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

const before = {};
for (const m of ['10', '98', '249']) {
    before[m] = (await sql.unsafe(`select count(*) c from sales_rop_day_calls('${day}','${m}')`))[0].c;
}

for (const f of ['20260902_day_calls_owner.sql', '20260902_call_review_owner_prompt.sql']) {
    await sql.unsafe(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    console.log('применено:', f);
}

console.log('\n— строк на менеджера: было → стало (склейка ног очереди) —');
for (const m of ['10', '98', '249']) {
    const after = (await sql.unsafe(`select count(*) c from sales_rop_day_calls('${day}','${m}')`))[0].c;
    console.log(`  менеджер ${m}: ${before[m]} → ${after}`);
}

console.log('\n— звонок по заказу 54494 (кто увидит его в своём дне) —');
for (const m of ['10', '98', '249']) {
    const r = await sql.unsafe(
        `select duration_sec, direction, order_number, order_manager_name
           from sales_rop_day_calls('${day}','${m}') where order_number = '54494'`,
    );
    console.log(`  менеджер ${m}:`, r.length ? JSON.stringify(r) : 'не показывается');
}

await sql.end();
