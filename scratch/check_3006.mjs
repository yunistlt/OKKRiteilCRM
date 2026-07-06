import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const DAY = `received_at >= '2026-06-30 00:00' AND received_at < '2026-07-01 00:00'`;

console.log('=== 30.06: ошибки анализа ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, from_email, left(subject,45) subj FROM incoming_emails WHERE ${DAY} AND reasoning='Ошибка анализа'`));

console.log('\n=== 30.06: слепые HTML (body_text пуст, html есть) — все типы ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, email_type, created_crm_order_number ord, from_email, left(subject,42) subj
  FROM incoming_emails WHERE ${DAY} AND coalesce(length(trim(body_text)),0)=0 AND coalesce(length(trim(body_html)),0)>0 ORDER BY received_at`));

console.log('\n=== 30.06: new_request со статусом error (заказ не создан) ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, from_email, left(subject,40) subj, left(error_message,50) err FROM incoming_emails WHERE ${DAY} AND email_type='new_request' AND status='error'`));

console.log('\n=== 30.06: procurement (проверить, нет ли клиентских заявок как surgut) ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, from_email, left(subject,45) subj, left(regexp_replace(coalesce(body_text,''),'\\s+',' ','g'),70) body FROM incoming_emails WHERE ${DAY} AND email_type='procurement' ORDER BY received_at`));

console.log('\n=== 30.06: not_request с непустым текстом — кандидаты в заявки (глазами) ===');
console.table(await sql.unsafe(`SELECT to_char(received_at,'HH24:MI') t, from_email, left(subject,38) subj, left(regexp_replace(coalesce(body_text,''),'\\s+',' ','g'),75) body
  FROM incoming_emails WHERE ${DAY} AND email_type='not_request' AND coalesce(length(trim(body_text)),0)>0 ORDER BY received_at`));
await sql.end();
