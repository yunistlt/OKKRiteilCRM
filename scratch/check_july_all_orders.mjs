import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log("=== Checking July 2026 orders specifically ===");
const orders = await sql`
  select order_id, status, totalsumm, created_at,
         raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' as data_peredachi,
         raw_payload->>'statusUpdatedAt' as status_updated_at
  from public.orders
  where manager_id = 98 and (
    created_at >= '2026-07-01' or
    (raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo')::date >= '2026-07-01'
  )
  order by created_at desc
`;
console.log(`Found ${orders.length} orders:`);
for (const o of orders) {
  console.log(`Order #${o.order_id}: status=${o.status}, totalsumm=${o.totalsumm}, created_at=${o.created_at.toISOString()}, data_peredachi=${o.data_peredachi}, status_updated_at=${o.status_updated_at}`);
}

console.log("\n=== Checking historical status changes to send-assembling in July 2026 ===");
const hist = await sql`
  select h.retailcrm_order_id, h.occurred_at, h.new_value
  from public.order_history_log h
  join public.orders o on o.order_id = h.retailcrm_order_id
  where o.manager_id = 98 and h.field = 'status' 
    and h.new_value LIKE '%"code":"send-assembling"%'
    and h.occurred_at >= '2026-07-01'
  order by h.occurred_at desc
`;
console.log("History entries:", hist);

await sql.end();
