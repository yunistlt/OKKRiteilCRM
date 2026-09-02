// Только чтение: что стоит за статусами, исключёнными из плана.
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

const picked = (await sql`select value from sales_rop_settings where key = 'plan_excluded_statuses'`)[0].value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

console.log('исключено статусов:', picked.length);

console.log('\n— заказы в этих статусах (рабочие, живые) —');
console.table(
    await sql`select coalesce(d.item_name, s.name) as status, ss.is_working as rabochiy, count(o.order_id) as zakazov,
                     round(sum(coalesce(o.totalsumm,0))) as summa
                from statuses s
                left join retailcrm_dictionaries d on d.item_code = s.code and d.entity_type = 'status'
                left join status_settings ss on ss.code = s.code
                left join public.orders o on o.status = s.code and o.updated_at >= now() - interval '400 days'
               where s.code = any(${picked})
               group by 1, 2 order by 3 desc`,
);

await sql.end();
