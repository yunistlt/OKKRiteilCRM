import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log("=== Checking Order 53607 ===");
const row53607 = await sql`
  select occurred_at, field, old_value, new_value
  from public.order_history_log
  where retailcrm_order_id = 53607 and field = 'status'
  order by occurred_at
`;
console.log("53607 History:", row53607);

console.log("\n=== Checking Order 53518 ===");
const row53518 = await sql`
  select occurred_at, field, old_value, new_value
  from public.order_history_log
  where retailcrm_order_id = 53518 and field = 'status'
  order by occurred_at
`;
console.log("53518 History:", row53518);

console.log("\n=== Querying salary_counted_orders for July 2026 (2026-07-01 to 2026-08-01) ===");
const julyCounted = await sql`
  select order_id, manager_id, entered_at, totalsumm
  from public.salary_counted_orders('2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00', 'send-assembling')
  where order_id in (53607, 53518)
`;
console.log("July counted:", julyCounted);

console.log("\n=== Querying salary_counted_orders for June 2026 (2026-06-01 to 2026-07-01) ===");
const juneCounted = await sql`
  select order_id, manager_id, entered_at, totalsumm
  from public.salary_counted_orders('2026-06-01 00:00:00+00', '2026-07-01 00:00:00+00', 'send-assembling')
  where order_id in (53607, 53518)
`;
console.log("June counted:", juneCounted);

await sql.end();
