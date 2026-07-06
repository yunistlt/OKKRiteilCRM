import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log("=== Checking july orders details ===");
const orderIds = [53658, 53659, 53661, 53665];

const orders = await sql`
  select order_id, status, manager_id, totalsumm,
         raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' as data_peredachi,
         raw_payload->>'statusUpdatedAt' as status_updated_at,
         created_at
  from public.orders
  where order_id in ${sql(orderIds)}
`;
console.log("Orders:", orders);

console.log("\n=== Checking order history log for status changes ===");
const hist = await sql`
  select retailcrm_order_id, occurred_at, field, old_value, new_value
  from public.order_history_log
  where retailcrm_order_id in ${sql(orderIds)} and field = 'status'
  order by retailcrm_order_id, occurred_at
`;
console.log("History:", hist);

console.log("\n=== Checking salary config for July 2026 ===");
const cfg = await sql`
  select key, value, effective_from
  from public.salary_config
  where effective_from <= '2026-07-01'
  order by effective_from desc
`;
console.log("Salary Configs:", cfg);

await sql.end();
