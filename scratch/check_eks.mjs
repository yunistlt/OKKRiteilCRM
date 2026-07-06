import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('order_blocklist:', JSON.stringify((await sql.unsafe(`SELECT order_blocklist FROM email_intake_config`))[0].order_blocklist));
console.log('\nПоследние письма от zapros_kp@aoeks.ru:');
console.table(await sql.unsafe(`SELECT to_char(received_at,'DD.MM HH24:MI') t, email_type, created_crm_order_number ord, left(reasoning,95) why
  FROM incoming_emails WHERE from_email='zapros_kp@aoeks.ru' ORDER BY received_at DESC LIMIT 6`));
await sql.end();
