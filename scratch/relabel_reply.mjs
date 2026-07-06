import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
console.log('=== будут переразмечены not_request → reply_thread (тег [#N/N]) ===');
const prev = await sql.unsafe(`SELECT to_char(received_at,'DD.MM HH24:MI') t, from_email, left(subject,50) subj
  FROM incoming_emails WHERE email_type='not_request' AND subject ~ '\\[#\\d+/\\d+\\]' AND received_at>=now()-interval '14 days' ORDER BY received_at DESC`);
console.table(prev);
const upd = await sql.unsafe(`UPDATE incoming_emails
  SET email_type='reply_thread',
      reasoning = 'Переписка по существующему заказу (тег [#…]) — ' || coalesce(reasoning,''),
      updated_at = now()
  WHERE email_type='not_request' AND subject ~ '\\[#\\d+/\\d+\\]' AND received_at>=now()-interval '14 days'
  RETURNING id`);
console.log(`Переразмечено: ${upd.length}`);
await sql.end();
