import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const pats = ['парфен','горде','матве'];
console.log('=== managers (CRM) ===');
const mgrs = await sql`select id, first_name, last_name, email from managers where ${sql.unsafe(pats.map(p=>`last_name ilike '%${p}%'`).join(' or '))}`;
console.table(mgrs);

console.log('=== users ===');
const users = await sql`select id, username, first_name, last_name, role, retail_crm_manager_id as mgr, (password_hash is not null) as has_pw, password_hash from users where ${sql.unsafe(pats.map(p=>`last_name ilike '%${p}%' or lower(coalesce(username,'')) like '%${p==='парфен'?'parfen':p==='горде'?'gorde':'matve'}%'`).join(' or '))}`;
for(const u of users) console.log({id:u.id, username:u.username, fn:u.first_name, ln:u.last_name, role:u.role, mgr:u.mgr, has_pw:u.has_pw, hash_prefix:String(u.password_hash||'').slice(0,7)});

console.log('=== profiles (Supabase) ===');
try{
  const profs = await sql`select id, email, username, first_name, last_name, role, retail_crm_manager_id as mgr from profiles where ${sql.unsafe(pats.map(p=>`last_name ilike '%${p}%' or lower(coalesce(email,'')) like '%${p==='парфен'?'parfen':p==='горде'?'gorde':'matve'}%'`).join(' or '))}`;
  console.table(profs);
}catch(e){console.log('profiles err',e.message)}

console.log('=== invitations ===');
try{
  const inv = await sql`select role, retail_crm_manager_id as mgr, first_name, last_name, note, revoked, used_count, last_used_at from access_invitations where ${sql.unsafe(pats.map(p=>`last_name ilike '%${p}%' or lower(coalesce(note,'')) like '%${p}%'`).join(' or '))}`;
  console.table(inv);
}catch(e){console.log('inv err',e.message)}

await sql.end();
