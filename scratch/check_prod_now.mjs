import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('now (UTC):', new Date().toISOString());
console.log('\n=== любые УСПЕШНЫЕ классификации за последний час (жив ли OpenAI в проде) ===');
console.table(await sql.unsafe(`
  SELECT to_char(updated_at,'HH24:MI:SS') upd, email_type, confidence, left(from_email,30) frm
  FROM incoming_emails
  WHERE updated_at >= now()-interval '60 min' AND reasoning<>'Ошибка анализа' AND email_type IS NOT NULL AND email_type<>'noreply'
  ORDER BY updated_at DESC LIMIT 10`));
console.log('\n=== переочередённые письма: трогает ли их крон (updated_at) ===');
console.table(await sql.unsafe(`
  SELECT to_char(updated_at,'HH24:MI:SS') upd, status, email_type, (reasoning='Ошибка анализа') err, left(from_email,28) frm
  FROM incoming_emails
  WHERE status='new' ORDER BY updated_at DESC LIMIT 20`));
await sql.end();
