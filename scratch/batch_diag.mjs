import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== "Ошибка анализа" (сбой AI) за 3 дня ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'DD.MM HH24:MI') recv, from_email, left(subject,50) subj
  FROM incoming_emails WHERE reasoning='Ошибка анализа' AND received_at>=now()-interval '3 days' ORDER BY received_at DESC`));

console.log('\n=== ВСЕ not_request за 2 дня (глазами найти реальные заявки) ===');
const nr = await sql.unsafe(`SELECT id, to_char(received_at,'DD.MM HH24:MI') recv, from_email,
  left(subject,42) subj,
  left(regexp_replace(coalesce(nullif(trim(body_text),''), left(body_html,0)),'\\s+',' ','g'),80) body_or_empty,
  (coalesce(length(trim(body_text)),0)=0 AND coalesce(length(trim(body_html)),0)>0) blind_html,
  reasoning='Ошибка анализа' err
  FROM incoming_emails WHERE email_type='not_request' AND received_at>=now()-interval '2 days' ORDER BY received_at DESC`);
console.table(nr);
await sql.end();
