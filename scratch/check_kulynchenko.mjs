import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT status, email_type, confidence, assigned_manager_id, created_crm_order_number, updated_at, left(reasoning,260) reasoning
  FROM incoming_emails WHERE id='e8e8dd29-5c64-4830-b4f5-695e3154c107'`);
console.log(JSON.stringify(r[0], null, 2));
await sql.end();
