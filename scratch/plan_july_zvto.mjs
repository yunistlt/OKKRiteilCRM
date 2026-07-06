import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

// candidate order-level fields that could mark legal entity / company
console.log('=== raw_payload top-level keys (sample) ===');
const k = await sql.unsafe(`SELECT DISTINCT jsonb_object_keys(raw_payload) kk FROM orders WHERE status='send-assembling' LIMIT 100`);
console.log(k.map(x=>x.kk).join(', '));

console.log('\n=== company / legalEntity values ===');
console.table(await sql.unsafe(`
  SELECT raw_payload->'company'->>'name' company,
         raw_payload->>'site' site,
         count(*) cnt
  FROM orders GROUP BY 1,2 ORDER BY cnt DESC LIMIT 25`));

await sql.end();
