import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const ids=[10,98,249];
for(const t of ['users','managers','crm_users','retailcrm_users','user_profiles']){
  const exists=await sql.unsafe(`SELECT 1 FROM information_schema.tables WHERE table_name=$1`,[t]);
  if(!exists.length) continue;
  const cols=(await sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`,[t])).map(c=>c.column_name);
  console.log(`\n[${t}] cols: ${cols.join(', ')}`);
  try{ const r=await sql.unsafe(`SELECT * FROM ${t} WHERE id = ANY($1) OR manager_id = ANY($1) LIMIT 5`,[ids]).catch(()=>null);
    if(r) for(const row of r) console.log('  ', JSON.stringify(row).slice(0,160)); }catch{}
}
// also retailcrm managers dictionary
console.log('\n[orders.manager_id → from raw_payload manager?]');
const mm = await sql.unsafe(`SELECT manager_id, raw_payload->'manager'->>'firstName' fn, raw_payload->'manager'->>'lastName' ln FROM orders WHERE manager_id=ANY($1) AND raw_payload->'manager' IS NOT NULL GROUP BY 1,2,3 LIMIT 10`,[ids]);
console.table(mm);
await sql.end();
