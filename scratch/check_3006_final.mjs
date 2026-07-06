import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const DAY = `received_at >= '2026-06-30 00:00' AND received_at < '2026-07-01 00:00'`;
console.log('=== 30.06: new_request БЕЗ заказа (кандидаты на потерю) ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, status, from_email, left(subject,40) subj, left(reasoning,80) why
  FROM incoming_emails WHERE ${DAY} AND email_type='new_request' AND created_crm_order_number IS NULL ORDER BY received_at`));
console.log('\n=== 30.06 сводка по типам + сколько заказов ===');
console.table(await sql.unsafe(`SELECT email_type, count(*) n, count(created_crm_order_number) orders FROM incoming_emails WHERE ${DAY} AND email_type IS NOT NULL GROUP BY email_type ORDER BY n DESC`));
await sql.end();
