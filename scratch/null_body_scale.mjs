import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('=== письма с пустым body_text, но НЕпустым body_html (классификатор был слеп), 14 дней ===');
const r = await sql.unsafe(`
  SELECT email_type, count(*) n,
    sum((coalesce(length(trim(body_html)),0)>0)::int) has_html
  FROM incoming_emails
  WHERE received_at >= now() - interval '14 days'
    AND coalesce(length(trim(body_text)),0) = 0
  GROUP BY email_type ORDER BY n DESC`);
console.table(r);
console.log('\n=== из них not_request с непустым html (потенциально потерянные) ===');
const lost = await sql.unsafe(`
  SELECT from_email, left(subject,55) subj, length(body_html) html_len
  FROM incoming_emails
  WHERE received_at >= now() - interval '14 days'
    AND email_type='not_request'
    AND coalesce(length(trim(body_text)),0)=0
    AND coalesce(length(trim(body_html)),0)>0
  ORDER BY received_at DESC LIMIT 25`);
console.table(lost);
await sql.end();
