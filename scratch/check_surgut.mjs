import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT id,status,email_type,confidence,forwarded_to,created_crm_order_number,
  to_char(received_at,'DD.MM HH24:MI') recv, to_char(updated_at,'DD.MM HH24:MI') upd,
  subject, body_text, attachments_meta, left(reasoning,220) reasoning
  FROM incoming_emails WHERE from_email='os-2@surgutmebel.ru' ORDER BY received_at DESC LIMIT 3`);
for (const x of r) console.log(JSON.stringify(x,null,2));
await sql.end();
