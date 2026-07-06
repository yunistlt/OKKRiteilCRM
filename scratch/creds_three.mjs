import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });
const rows = await sql`select username, password_hash as password, role, retail_crm_manager_id as mgr, email from users where username in ('Parfenova_Elenaa','Evgenia2222','IrinaGordeeva777')`;
for(const r of rows) console.log({login:r.username, password:r.password, role:r.role, mgr:r.mgr, email:r.email});
await sql.end();
