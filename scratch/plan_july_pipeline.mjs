import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

// status dictionary with groups?
console.log('=== status dictionaries (looking for groups) ===');
const dicts = await sql.unsafe(`SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%status%' OR table_name ILIKE '%dictionar%'`);
console.log(dicts.map(d=>d.table_name).join(', '));

for(const t of dicts){
  const cols = await sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`,[t.table_name]);
  console.log(`\n${t.table_name}: ${cols.map(c=>c.column_name).join(', ')}`);
}
await sql.end();
