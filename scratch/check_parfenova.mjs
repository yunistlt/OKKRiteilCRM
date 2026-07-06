import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log('=== users c Парфенова ===');
const u = await sql`select id, username, first_name, last_name, role, retail_crm_manager_id as mgr, (password_hash is not null) as has_pw from users where lower(username) like '%parfenov%' or last_name ilike '%парфенов%'`;
console.table(u);

console.log('=== profiles c Парфенова ===');
try {
  const p = await sql`select id, email, username, first_name, last_name, role, retail_crm_manager_id as mgr from profiles where lower(coalesce(email,'')) like '%parfenov%' or last_name ilike '%парфенов%' or lower(coalesce(username,'')) like '%parfenov%'`;
  console.table(p);
} catch(e){ console.log('profiles err', e.message); }

console.log('=== managers c Парфенова ===');
const m = await sql`select id, first_name, last_name, email from managers where last_name ilike '%парфенов%' or first_name ilike '%парфенов%'`;
console.table(m);

console.log('=== salary_period 2026-05 ===');
const sp = await sql`select id, year, month, status from salary_period where year=2026 and month=5`;
console.table(sp);

if (sp.length) {
  console.log('=== salary_calc for Парфенова managers ===');
  const ids = m.map(x=>Number(x.id));
  const sc = await sql`select manager_id, total from salary_calc where period_id=${sp[0].id} and manager_id = any(${ids})`;
  console.table(sc);
}

console.log('=== salary_participant for those managers ===');
const ids = m.map(x=>Number(x.id));
if (ids.length){
  const part = await sql`select manager_id from salary_participant where manager_id = any(${ids})`;
  console.table(part);
}

await sql.end();
