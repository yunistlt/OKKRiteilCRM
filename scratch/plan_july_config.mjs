import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== salary_config tables ===');
console.table(await sql.unsafe(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'salary%'`));

const t = await sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='salary_config'`);
console.log('salary_config cols:', t.map(x=>x.column_name).join(', '));

const cfg = await sql.unsafe(`SELECT * FROM salary_config ORDER BY effective_from DESC LIMIT 3`).catch(e=>e.message);
console.log(JSON.stringify(cfg, null, 1).slice(0, 2000));

await sql.end();
