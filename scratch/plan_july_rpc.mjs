import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== salary_counted_orders definition ===');
const def = await sql.unsafe(`SELECT pg_get_functiondef(oid) d FROM pg_proc WHERE proname='salary_counted_orders'`);
console.log(def[0]?.d || 'NOT FOUND');

await sql.end();
