import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('=== последние 15 разобранных не-noreply писем (жив ли AI в проде) ===');
const r = await sql.unsafe(`
  SELECT to_char(received_at,'DD.MM HH24:MI') recv, to_char(updated_at,'DD.MM HH24:MI') upd,
         email_type, confidence, (reasoning='Ошибка анализа') err, left(from_email,32) frm
  FROM incoming_emails
  WHERE email_type IS NOT NULL AND email_type<>'noreply'
  ORDER BY updated_at DESC LIMIT 15`);
console.table(r);
console.log('\n=== статус очереди: сколько сейчас new (ждут разбора) ===');
console.log(JSON.stringify((await sql.unsafe(`SELECT status, count(*) n FROM incoming_emails GROUP BY status ORDER BY n DESC`))));
await sql.end();
