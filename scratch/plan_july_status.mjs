import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== status distribution (count, sum) ===');
console.table(await sql.unsafe(`SELECT status, count(*) cnt, round(sum(totalsumm)) sum FROM orders GROUP BY status ORDER BY cnt DESC`));

console.log('\n=== raw_payload date keys sample ===');
const r = await sql.unsafe(`SELECT raw_payload->>'createdAt' c, raw_payload->>'statusUpdatedAt' su, raw_payload->>'fullPaidAt' fp, raw_payload->>'shipmentDate' sd FROM orders WHERE totalsumm>0 ORDER BY created_at DESC LIMIT 5`);
console.table(r);

await sql.end();
