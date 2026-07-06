import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
await sql.unsafe(`UPDATE email_intake_config SET order_blocklist = ARRAY['pharmperspectiva.ru'], updated_at = now() WHERE id = true`);
const r = await sql.unsafe(`SELECT order_blocklist FROM email_intake_config`);
console.log('order_blocklist =', JSON.stringify(r[0].order_blocklist));
await sql.end();
