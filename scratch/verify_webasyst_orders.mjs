import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT subject, created_crm_order_number ord, assigned_manager_id mgr, left(reasoning,150) why
  FROM incoming_emails WHERE from_email ILIKE '%webasyst%' AND created_crm_order_number IS NOT NULL ORDER BY received_at DESC`);
for(const x of r) console.log(`№${x.ord} mgr=${x.mgr} | ${x.subject}\n   ${x.why}\n`);
await sql.end();
