// Догнать таблицу позиций из raw_payload. Пишет только в order_items.
// Запуск: node scripts/own-crm-backfill-items.mjs
import postgres from 'postgres'
import fs from 'fs'
const url = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'')
const sql = postgres(url, { ssl:'require', max:1 })
const r = await sql`
  insert into order_items (
    "id", order_id, "quantity","initialPrice","purchasePrice","discountTotal",
    "bonusesChargeTotal","bonusesCreditTotal","status","vatRate","comment","ordering",
    "isCanceled","createdAt","offer","priceType","prices","discounts","properties","markingObjects", updated_at)
  select (el->>'id')::bigint, coalesce(o.order_id, o.id),
    nullif(el->>'quantity','')::numeric, nullif(el->>'initialPrice','')::numeric,
    nullif(el->>'purchasePrice','')::numeric, nullif(el->>'discountTotal','')::numeric,
    nullif(el->>'bonusesChargeTotal','')::numeric, nullif(el->>'bonusesCreditTotal','')::numeric,
    nullif(el->>'status',''), nullif(el->>'vatRate',''), nullif(el->>'comment',''),
    nullif(el->>'ordering','')::integer, nullif(el->>'isCanceled','')::boolean,
    nullif(el->>'createdAt','')::timestamptz,
    el->'offer', el->'priceType', el->'prices', el->'discounts', el->'properties', el->'markingObjects', now()
  from orders o, lateral jsonb_array_elements(o.raw_payload->'items') el
  where o.raw_payload is not null and el->>'id' ~ '^[0-9]+$'
  on conflict ("id") do update set
    "quantity" = excluded."quantity", "initialPrice" = excluded."initialPrice",
    "purchasePrice" = excluded."purchasePrice", "discountTotal" = excluded."discountTotal",
    "status" = excluded."status", "offer" = excluded."offer", "prices" = excluded."prices",
    "discounts" = excluded."discounts", "properties" = excluded."properties", updated_at = now()
  returning "id"`
console.log('позиций записано:', r.length)
const chk = await sql`select
  (select count(*)::int from order_items) in_table,
  (select count(*)::int from orders o, lateral jsonb_array_elements(o.raw_payload->'items') el where el->>'id' ~ '^[0-9]+$') in_json`
console.log(chk[0])
await sql.end()
