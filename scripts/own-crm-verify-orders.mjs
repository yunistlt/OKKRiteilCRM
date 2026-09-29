// Сверка Z-6: колонки заказа против raw_payload. Только чтение.
// Запуск: node scripts/own-crm-verify-orders.mjs
import postgres from 'postgres'
import fs from 'fs'
const url = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'')
const sql = postgres(url, { ssl:'require', max:1 })
const cf = await sql`select code, name, type from retailcrm_custom_fields where entity='order' order by code`
const cols = new Set((await sql`select column_name from information_schema.columns where table_name='orders'`).map(c=>c.column_name))
const checks = []
for (const k of ['orderType','orderMethod','currency','managerComment','statusComment','customerComment','firstName','lastName','email','additionalPhone','shipmentStore','externalId'])
  checks.push([k, `"${k}" is distinct from nullif(raw_payload->>'${k}','')`])
for (const k of ['summ','prepaySum','purchaseSumm','weight','width','height','length'])
  checks.push([k, `"${k}" is distinct from nullif(raw_payload->>'${k}','')::numeric`])
for (const k of ['createdAt','statusUpdatedAt','markDatetime','fullPaidAt'])
  checks.push([k, `"${k}" is distinct from nullif(raw_payload->>'${k}','')::timestamptz`])
for (const k of ['call','expired','fromApi','shipped'])
  checks.push([k, `"${k}" is distinct from nullif(raw_payload->>'${k}','')::boolean`])
for (const k of ['delivery','contragent','contact','company','source','loyaltyLevel','links'])
  checks.push([k, `"${k}" is distinct from raw_payload->'${k}'`])
for (const f of cf) {
  const col = f.code.slice(0,63)
  if (!cols.has(col) || !['string','text','dictionary','email'].includes(f.type)) continue
  checks.push([f.code, `"${col}" is distinct from nullif(raw_payload->'customFields'->>'${f.code}','')`])
}
const total = (await sql`select count(*)::int n from orders where raw_payload is not null`)[0].n
let bad = 0
for (const [name, cond] of checks) {
  const n = (await sql.unsafe(`select count(*)::int n from orders where raw_payload is not null and (${cond})`))[0].n
  if (n) { bad++; console.log(`расходится ${String(n).padStart(6)} из ${total}: ${name}`) }
}
console.log(bad ? `\nполей с расхождением: ${bad} из ${checks.length}` : `\nвсе ${checks.length} полей совпали на ${total} заказах`)
await sql.end()
