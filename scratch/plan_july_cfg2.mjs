import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const rows = await sql.unsafe(`SELECT DISTINCT ON (key) key, value FROM salary_config WHERE key IN ('closing_status','nds_normalization') ORDER BY key, effective_from DESC`);
for (const r of rows) console.log(r.key, '=', JSON.stringify(r.value));
// also existing plans
console.log('\n=== existing salary_plan rows ===');
console.table(await sql.unsafe(`SELECT year, month, metric, manager_id, target FROM salary_plan ORDER BY year DESC, month DESC LIMIT 20`));
await sql.end();
