import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const cols = await sql.unsafe(`SELECT column_name, data_type, column_default
  FROM information_schema.columns WHERE table_name='email_intake_config' ORDER BY ordinal_position`);
console.table(cols);
const row = await sql.unsafe(`SELECT * FROM email_intake_config`);
console.log('rows:', row.length, JSON.stringify(row[0]||{}, null, 0).slice(0,500));
await sql.end();
