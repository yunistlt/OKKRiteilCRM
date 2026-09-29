// Z-5: заполнение колонок заказа из raw_payload. Пишет ТОЛЬКО в новые колонки,
// заведённые миграцией 20260928_orders_retailcrm_columns.sql.
// Пустую строку от RetailCRM кладём как «нет значения» (NULL).
// Запуск: node scripts/own-crm-backfill-orders.mjs [--all]
import postgres from 'postgres'
import fs from 'fs'
const url = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'')
const all = process.argv.includes('--all')
const sql = postgres(url, { ssl:'require', max:1 })
const std = {
  orderType:"nullif(p->>'orderType','')", orderMethod:"nullif(p->>'orderMethod','')",
  countryIso:"nullif(p->>'countryIso','')", currency:"nullif(p->>'currency','')",
  privilegeType:"nullif(p->>'privilegeType','')", managerComment:"nullif(p->>'managerComment','')",
  statusComment:"nullif(p->>'statusComment','')", customerComment:"nullif(p->>'customerComment','')",
  firstName:"nullif(p->>'firstName','')", lastName:"nullif(p->>'lastName','')",
  patronymic:"nullif(p->>'patronymic','')", email:"nullif(p->>'email','')",
  additionalPhone:"nullif(p->>'additionalPhone','')", shipmentStore:"nullif(p->>'shipmentStore','')",
  externalId:"nullif(p->>'externalId','')",
  createdAt:"nullif(p->>'createdAt','')::timestamptz", statusUpdatedAt:"nullif(p->>'statusUpdatedAt','')::timestamptz",
  markDatetime:"nullif(p->>'markDatetime','')::timestamptz", fullPaidAt:"nullif(p->>'fullPaidAt','')::timestamptz",
  shipmentDate:"nullif(p->>'shipmentDate','')::date",
  slug:"nullif(p->>'slug','')::bigint", summ:"nullif(p->>'summ','')::numeric",
  prepaySum:"nullif(p->>'prepaySum','')::numeric", purchaseSumm:"nullif(p->>'purchaseSumm','')::numeric",
  bonusesChargeTotal:"nullif(p->>'bonusesChargeTotal','')::numeric",
  bonusesCreditTotal:"nullif(p->>'bonusesCreditTotal','')::numeric",
  personalDiscountPercent:"nullif(p->>'personalDiscountPercent','')::numeric",
  weight:"nullif(p->>'weight','')::numeric", width:"nullif(p->>'width','')::numeric",
  height:"nullif(p->>'height','')::numeric", length:"nullif(p->>'length','')::numeric",
  call:"nullif(p->>'call','')::boolean", expired:"nullif(p->>'expired','')::boolean",
  fromApi:"nullif(p->>'fromApi','')::boolean", shipped:"nullif(p->>'shipped','')::boolean",
  delivery:"p->'delivery'", contragent:"p->'contragent'", contact:"p->'contact'",
  company:"p->'company'", source:"p->'source'", loyaltyLevel:"p->'loyaltyLevel'", links:"p->'links'",
}
const have = new Set((await sql`select column_name from information_schema.columns where table_name='orders'`).map(c=>c.column_name))
const cf = await sql`select code, type from retailcrm_custom_fields where entity='order'`
const parts = []
for (const [c,e] of Object.entries(std)) if (have.has(c)) parts.push(`"${c}" = ${e}`)
for (const f of cf) {
  const col = f.code.slice(0,63)
  if (!have.has(col)) continue
  const v = `p->'customFields'->>'${f.code}'`
  let e
  if (f.type==='integer') e = `case when ${v} ~ '^-?[0-9]+$' then (${v})::integer end`
  else if (f.type==='numeric') e = `case when ${v} ~ '^-?[0-9]+([.,][0-9]+)?$' then replace(${v},',','.')::numeric end`
  else if (f.type==='boolean') e = `case when ${v} in ('true','false','1','0') then (${v} in ('true','1')) end`
  else if (f.type==='date') e = `case when ${v} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(${v},10)::date end`
  else e = `nullif(${v},'')`
  parts.push(`"${col}" = ${e}`)
}
const where = all ? 'raw_payload is not null' : `raw_payload is not null and "createdAt" is null`
let done = 0
while (true) {
  const r = await sql.unsafe(`
    with batch as (select id, raw_payload as p from orders where ${where} ${all?'and id > '+done:''} order by id limit 2000)
    update orders o set ${parts.join(', ')} from batch where o.id = batch.id returning o.id`)
  if (!r.length) break
  done = all ? r[r.length-1].id : done + r.length
  process.stdout.write(`\rзаполнено ${all?'до id '+done:done}`)
}
console.log(`\nготово, колонок в наборе: ${parts.length}`)
await sql.end()
