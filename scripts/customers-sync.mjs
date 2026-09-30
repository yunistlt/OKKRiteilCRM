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
      on conflict ("id") do update set "externalId"=excluded."externalId", "firstName"=excluded."firstName",
        "lastName"=excluded."lastName", "patronymic"=excluded."patronymic", "email"=excluded."email",
        "phones"=excluded."phones", "site"=excluded."site", "managerId"=excluded."managerId",
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

// Связь контакта с юрлицом — из заказов, без лишних обращений к их API.
const linked = await sql`
  insert into customer_companies (customer_id, company_id, orders_count, updated_at)
  select ("customer"->>'id')::bigint, ("company"->>'id')::bigint, count(*)::int, now()
    from orders
   where "customer"->>'id' ~ '^[0-9]+$' and "company"->>'id' ~ '^[0-9]+$'
   group by 1, 2
  on conflict (customer_id, company_id) do update set orders_count = excluded.orders_count, updated_at = now()
  returning customer_id`
console.log('связей контакт-юрлицо:', linked.length)
await sql.end()
