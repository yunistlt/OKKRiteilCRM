import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== not_request с ПУСТЫМ телом, но с вложением (возможные пропущенные заявки) ===');
const a = await sql.unsafe(`
  SELECT from_email, left(subject,55) subj, has_attachments,
         coalesce(jsonb_array_length(attachments_meta),0) n_att
  FROM incoming_emails
  WHERE received_at >= now() - interval '7 days'
    AND email_type='not_request'
    AND coalesce(length(trim(body_text)),0) < 30
  ORDER BY has_attachments DESC`);
console.table(a);

console.log('\n=== "Тендер на ЭТП" от pharmperspectiva → создано заказов ===');
const b = await sql.unsafe(`
  SELECT created_crm_order_number ord, left(subject,30) subj,
         substring(body_text from 'тип тендера: ''([^'']+)''') tender_type,
         email_type
  FROM incoming_emails
  WHERE received_at >= now() - interval '7 days'
    AND from_email='dmto@pharmperspectiva.ru'
  ORDER BY received_at`);
console.table(b);

console.log('\n=== procurement: что переслали в Снабжение ===');
const c = await sql.unsafe(`
  SELECT from_email, left(subject,50) subj
  FROM incoming_emails
  WHERE received_at >= now() - interval '7 days' AND email_type='procurement'
  ORDER BY received_at`);
console.table(c);
await sql.end();
