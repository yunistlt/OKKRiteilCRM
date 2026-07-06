import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const upd = await sql.unsafe(`UPDATE incoming_emails SET email_type='blocked', updated_at=now()
  WHERE email_type='new_request' AND created_crm_order_number IS NULL AND reasoning ILIKE '%списке исключений%'
  RETURNING from_email`);
console.log(`Переразмечено blocked: ${upd.length}`);
const byd = {}; for(const r of upd) byd[r.from_email]=(byd[r.from_email]||0)+1;
console.log(JSON.stringify(byd,null,2));
await sql.end();
