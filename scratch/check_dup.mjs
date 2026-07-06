import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log('=== users mapped to manager 10 ===');
console.table(await sql`select id, username, first_name, last_name, role, retail_crm_manager_id as mgr, (password_hash is not null) as has_pw from users where retail_crm_manager_id=10`);

console.log('=== users by elena/kurbaeva email/username ===');
console.table(await sql`select id, username, first_name, last_name, role, retail_crm_manager_id as mgr, (password_hash is not null) as has_pw from users where lower(coalesce(username,'')) like '%elena%' or lower(coalesce(username,'')) like '%kurbaev%' or lower(coalesce(username,'')) like '%kurbaeva%'`);

console.log('=== profiles mapped to manager 10 or elena ===');
try{ console.table(await sql`select id, email, username, first_name, last_name, role, retail_crm_manager_id as mgr from profiles where retail_crm_manager_id=10 or lower(coalesce(email,'')) like '%elena%' or lower(coalesce(email,'')) like '%kurbaev%' or lower(coalesce(username,'')) like '%elena%'`);}catch(e){console.log('profiles err',e.message)}

console.log('=== invitations elena/parfenova ===');
try{ console.table(await sql`select token, role, retail_crm_manager_id as mgr, first_name, last_name, note, revoked, used_count from access_invitations where lower(coalesce(note,'')) like '%парфен%' or last_name ilike '%парфен%' or retail_crm_manager_id=10`);}catch(e){console.log('inv err',e.message)}

await sql.end();
