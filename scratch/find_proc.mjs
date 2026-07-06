import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('=== Последние пересылки в Снабжение (procurement), 30 дней ===');
const r = await sql.unsafe(`
  SELECT to_char(received_at,'DD.MM HH24:MI') t, from_email, left(subject,70) subj,
         forwarded_to, status,
         (subject ~ '\\[#\\d+/\\d+\\]' OR subject ~* '(^|\\s)re\\s*:') AS is_order_thread
  FROM incoming_emails
  WHERE email_type='procurement' AND received_at >= now() - interval '30 days'
  ORDER BY received_at DESC LIMIT 30`);
console.table(r);
await sql.end();
