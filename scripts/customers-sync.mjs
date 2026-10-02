// Синхронизация контактных лиц RetailCRM в таблицу customers.
// Только чтение из RetailCRM. Идемпотентно, можно гонять сколько угодно раз.
// Запуск: node scripts/customers-sync.mjs [--since 2026-01-01]
import postgres from 'postgres'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const crmUrl = (env.match(/^RETAILCRM_URL=(.*)$/m)?.[1] || env.match(/^RETAILCRM_BASE_URL=(.*)$/m)?.[1]).trim()
const crmKey = env.match(/^RETAILCRM_API_KEY=(.*)$/m)[1].trim()
const sql = postgres(env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, ''), { ssl: 'require', max: 1 })

const sinceArg = process.argv.indexOf('--since')
const since = sinceArg > -1 ? process.argv[sinceArg + 1] : null

let page = 1, saved = 0
for (;;) {
  const filter = since ? `&filter[dateFrom]=${encodeURIComponent(since)}` : ''
  const res = await fetch(`${crmUrl}/api/v5/customers?apiKey=${crmKey}&limit=100&page=${page}${filter}`)
  if (!res.ok) throw new Error(`страница ${page}: ${res.status}`)
  const data = await res.json()
  const rows = data.customers || []
  if (!rows.length) break

  for (const c of rows) {
    const phones = (c.phones || []).map((p) => String(p.number || '').replace(/[^\d+]/g, '')).filter(Boolean)
    await sql`insert into customers ("id","externalId","firstName","lastName","patronymic","email","phones","site",
        "managerId","vip","bad","isContact","createdAt","ordersCount","totalSumm","averageSumm","personalDiscount",
        "segments","customFields",raw,updated_at)
      values (${c.id}, ${c.externalId ?? null}, ${c.firstName ?? null}, ${c.lastName ?? null}, ${c.patronymic ?? null},
        ${c.email ?? null}, ${phones}, ${c.site ?? null}, ${c.managerId ?? null}, ${c.vip ?? null}, ${c.bad ?? null},
        ${c.isContact ?? null}, ${c.createdAt ?? null}, ${c.ordersCount ?? null}, ${c.totalSumm ?? null},
        ${c.averageSumm ?? null}, ${c.personalDiscount ?? null}, ${sql.json(c.segments ?? [])},
        ${sql.json(c.customFields ?? {})}, ${sql.json(c)}, now())
      on conflict ("id") do update set "externalId"=excluded."externalId",
        -- ФИО, телефоны и почту правят в ОКК и в RetailCRM не отправляют
        -- (решение владельца 02.10.2026), поэтому у правленных строк
        -- (okk_edited_at) свои значения остаются.
        "firstName"=case when customers.okk_edited_at is null then excluded."firstName" else customers."firstName" end,
        "lastName"=case when customers.okk_edited_at is null then excluded."lastName" else customers."lastName" end,
        "patronymic"=case when customers.okk_edited_at is null then excluded."patronymic" else customers."patronymic" end,
        "email"=case when customers.okk_edited_at is null then excluded."email" else customers."email" end,
        "phones"=case when customers.okk_edited_at is null then excluded."phones" else customers."phones" end,
        "site"=excluded."site", "managerId"=excluded."managerId",
        "vip"=excluded."vip", "bad"=excluded."bad", "isContact"=excluded."isContact",
        "ordersCount"=excluded."ordersCount", "totalSumm"=excluded."totalSumm",
        "averageSumm"=excluded."averageSumm", "personalDiscount"=excluded."personalDiscount",
        "segments"=excluded."segments", "customFields"=excluded."customFields", raw=excluded.raw, updated_at=now()`
  }
  saved += rows.length
  process.stdout.write(`\rконтактов сохранено: ${saved}`)
  if (page >= (data.pagination?.totalPageCount || 1)) break
  page++
}
console.log(`\nвсего: ${saved}`)

// Кто из контактов относится к какому клиенту — по заказам, без лишних
// обращений к их API. Покупатель заказа это наша карточка клиента, а контакт —
// человек, с которым говорят.
const linked = await sql`
  insert into client_contacts (client_id, contact_id, orders_count, last_order_at, updated_at)
  select ("customer"->>'id')::bigint, ("contact"->>'id')::bigint, count(*)::int, max("createdAt"), now()
    from orders
   where "customer"->>'id' ~ '^[0-9]+$' and "contact"->>'id' ~ '^[0-9]+$'
     and "customer"->>'id' <> "contact"->>'id'
   group by 1, 2
  on conflict (client_id, contact_id) do update set
    orders_count = excluded.orders_count, last_order_at = excluded.last_order_at, updated_at = now()
  returning client_id`
console.log('связей клиент-контакт:', linked.length)
await sql.end()
