import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log('=== managers Хапилова ===');
const m = await sql`select id, first_name, last_name, email, active,
  (raw_data->'groups') as groups
  from managers where last_name ilike '%хапилов%' or first_name ilike '%хапилов%'`;
console.table(m.map(x=>({id:x.id, fio:x.last_name+' '+x.first_name, email:x.email, active:x.active})));
for (const x of m){
  console.log(`groups for id=${x.id}:`, JSON.stringify(x.groups));
}

const ids = m.map(x=>Number(x.id));
if (ids.length){
  console.log('=== salary_participant ===');
  const part = await sql`select manager_id, created_at from salary_participant where manager_id = any(${ids})`;
  console.table(part);

  console.log('=== salary_manager_comp (выбор роли) ===');
  try {
    const c = await sql`select * from salary_manager_comp where manager_id = any(${ids}) order by effective_from`;
    console.table(c);
  } catch(e){ console.log('comp err', e.message); }
}

console.log('=== схемы (salary_scheme коды/группы) ===');
try {
  const sc = await sql`select code, name, is_active from salary_scheme order by code`;
  console.table(sc);
} catch(e){ console.log('scheme err', e.message); }

await sql.end();
