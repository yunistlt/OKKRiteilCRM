import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT id,status,email_type,confidence,assigned_manager_id,created_crm_order_number,forwarded_to,
  to_char(received_at,'DD.MM HH24:MI') recv, to_char(updated_at,'DD.MM HH24:MI') upd,
  subject, body_text, attachments_meta, error_message, reasoning
  FROM incoming_emails WHERE from_email='n.pozdnyakova@smartfleet.pro' ORDER BY received_at DESC LIMIT 3`);
for (const x of r) console.log(JSON.stringify(x,null,2));
console.log('\n--- блок-лист + режимы ---');
console.log(JSON.stringify((await sql.unsafe(`SELECT create_orders, forward_enabled, order_blocklist FROM email_intake_config`))[0]));
await sql.end();
