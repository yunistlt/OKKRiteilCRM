import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log("=== Checking recent audit logs ===");
const logs = await sql`
  select id, entity, entity_id, action, actor, created_at, old_value, new_value
  from public.salary_audit_log
  order by created_at desc
  limit 20
`;
console.log(logs);

await sql.end();
