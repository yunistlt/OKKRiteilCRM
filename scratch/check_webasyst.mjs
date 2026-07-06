import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('=== письма от webasyst (магазин) ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'DD.MM HH24:MI') t, from_email, email_type, created_crm_order_number ord, left(subject,40) subj
  FROM incoming_emails WHERE from_email ILIKE '%webasyst%' OR subject ILIKE 'Новый заказ %' ORDER BY received_at DESC LIMIT 15`));
console.log('\n=== сколько всего noreply-писем от webasyst ===');
console.log(JSON.stringify((await sql.unsafe(`SELECT count(*) n FROM incoming_emails WHERE from_email ILIKE '%webasyst%'`))[0]));
await sql.end();
