import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT id,status,email_type,confidence,created_crm_order_number,
  to_char(received_at,'DD.MM HH24:MI') recv,
  subject, body_text, coalesce(length(body_html),0) html_len, attachments_meta, reasoning
  FROM incoming_emails WHERE from_email='alfa.25@ap-ps.ru' ORDER BY received_at DESC LIMIT 2`);
for (const x of r) console.log(JSON.stringify(x,null,2));
await sql.end();
