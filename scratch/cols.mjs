import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });
for (const t of ['salary_calc','salary_scheme','salary_scheme_block','salary_config','salary_plan','salary_period','salary_manager_comp','salary_grade']){
  const c = await sql`select column_name, data_type from information_schema.columns where table_name=${t} order by ordinal_position`;
  console.log(`\n${t}:`, c.map(x=>x.column_name).join(', '));
}
await sql.end();
