import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

// columns
const cols = await sql`select column_name, data_type from information_schema.columns where table_name='access_invitations' order by ordinal_position`;
console.log('=== columns ===');
console.table(cols);

const inv = await sql`select * from access_invitations order by created_at desc nulls last`;
console.log('=== all invitations (', inv.length, ') ===');
for(const r of inv){
  console.log({
    who: `${r.first_name||''} ${r.last_name||''}`.trim()||'(нет имени)',
    role: r.role, mgr: r.retail_crm_manager_id,
    revoked: r.revoked, used_count: r.used_count, max_uses: r.max_uses,
    expires_at: r.expires_at, last_used_at: r.last_used_at, created_at: r.created_at,
    note: r.note, token_tail: '...'+String(r.token).slice(-8)
  });
}
await sql.end();
