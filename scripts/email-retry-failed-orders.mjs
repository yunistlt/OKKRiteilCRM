// Вернуть в очередь письма-заявки, по которым заказ не создался из-за сбоя
// на стороне RetailCRM. Ставит статус «новое» и обнуляет счётчик попыток —
// крон разберёт их в ближайшие пять минут.
// Запуск: node scripts/email-retry-failed-orders.mjs [--like "часть текста ошибки"]
import postgres from 'postgres'
import fs from 'fs'
const url = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'')
const arg = process.argv.indexOf('--like')
const like = arg > -1 ? process.argv[arg + 1] : "parameter 'site'"
const sql = postgres(url, { ssl:'require', max:1 })
const rows = await sql`
  update incoming_emails
     set status = 'new', order_create_attempts = 0, updated_at = now()
   where status = 'error' and email_type = 'new_request'
     and error_message ilike ${'%' + like + '%'}
  returning id, received_at, from_email, subject`
console.log(`возвращено в работу писем: ${rows.length}`)
rows.forEach(r => console.log(` ${new Date(r.received_at).toISOString().slice(5,16)} ${r.from_email} — ${String(r.subject||'без темы').slice(0,50)}`))
await sql.end()
