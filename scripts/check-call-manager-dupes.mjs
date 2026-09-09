// Только чтение: один разговор — две строки на разных менеджеров?
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

console.log('— звонки по заказу 54494 за 02.09 —');
console.table(
    await sql`select rc_call_id, call_type, manager_rc_id, manager_name, record_uuid, external_id,
                     duration_sec, ext_code, result
                from retailcrm_calls
               where phone_normalized like '%9528311471%' and call_date::date = '2026-09-02'
               order by call_date`,
);

console.log('— как часто один record_uuid висит на разных менеджерах (с 01.08) —');
console.table(
    await sql`select count(*) as razgovorov from (
                select record_uuid from retailcrm_calls
                 where call_date >= '2026-08-01' and record_uuid is not null
                 group by record_uuid having count(distinct manager_rc_id) > 1) x`,
);

console.log('— как часто менеджер звонка ≠ менеджер заказа (с 01.08) —');
console.table(
    await sql`select count(*) filter (where c.manager_rc_id::text is distinct from o.manager_id::text) as raskhodyatsya,
                     count(*) as vsego_s_zakazom
                from retailcrm_calls c
                join public.orders o on o.number = c.order_number
               where c.call_date >= '2026-08-01' and c.order_number is not null`,
);

await sql.end();
