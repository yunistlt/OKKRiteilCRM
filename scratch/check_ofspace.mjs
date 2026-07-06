import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT id,email_type,created_crm_order_number ord, subject,
  body_text, coalesce(length(body_html),0) html_len, attachments_meta,
  to_char(received_at,'DD.MM HH24:MI') recv
  FROM incoming_emails WHERE from_email='n_lischinets@ofspace.ru' ORDER BY received_at DESC LIMIT 2`);
for (const x of r){ console.log(JSON.stringify({...x, body_text_len:(x.body_text||'').length}, null, 2)); }
// покажем начало HTML
if (r[0]) {
  const h = (await sql.unsafe(`SELECT left(body_html, 700) h FROM incoming_emails WHERE id='${r[0].id}'`))[0].h;
  console.log('\n--- HTML начало ---\n', h);
}
await sql.end();
