import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log('=== salary_scheme коды/даты ===');
const sc = await sql`select code, name, effective_from from salary_scheme order by code, effective_from`;
console.table(sc);

console.log('=== userGroup в справочнике (фильтр коллцентр/менеджер) ===');
const g = await sql`select item_code, item_name from retailcrm_dictionaries where entity_type='userGroup' and (item_code ilike '%koll%' or item_name ilike '%коллцентр%' or item_code ilike '%menedzher%') order by item_code`;
console.table(g);

await sql.end();
