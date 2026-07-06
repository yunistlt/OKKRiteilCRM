import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`
  SELECT id, from_email, from_name, subject, body_text, has_attachments, attachments_meta, status, email_type, imap_uid, received_at
  FROM incoming_emails WHERE from_email='exp-n@yandex.ru' AND received_at >= now() - interval '7 days'`);
for (const x of r) console.log(JSON.stringify(x, null, 2));
console.log('\n--- образцы attachments_meta у разных писем ---');
const s = await sql.unsafe(`SELECT from_email, attachments_meta FROM incoming_emails WHERE has_attachments=true AND attachments_meta IS NOT NULL AND received_at >= now() - interval '7 days' LIMIT 5`);
for (const x of s) console.log(x.from_email, '::', JSON.stringify(x.attachments_meta));
await sql.end();
