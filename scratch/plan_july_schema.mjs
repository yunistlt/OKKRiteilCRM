import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

const cols = await sql.unsafe(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='orders' ORDER BY ordinal_position`);
console.log('=== orders columns ===');
console.table(cols);

console.log('\n=== row count ===');
console.log((await sql.unsafe(`SELECT count(*) FROM orders`))[0]);

await sql.end();
