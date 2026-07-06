import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const r = await sql.unsafe(`SELECT id, first_name, last_name, active FROM managers WHERE id = ANY($1)`,[[10,98,249]]);
console.table(r);
await sql.end();
