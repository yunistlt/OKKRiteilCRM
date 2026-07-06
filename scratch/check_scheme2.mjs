import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });
const schemes = await sql`select id, code, name, effective_from, archived_at from salary_scheme where code='menedzhery' order by effective_from`;
console.log('=== salary_scheme code=menedzhery ===');
for (const s of schemes) {
  console.log('\nid', s.id, '| eff', s.effective_from, '| arch', s.archived_at, '|', s.name);
  const blocks = await sql`select block_code, enabled, sort_order, params from salary_scheme_block where scheme_id=${s.id} order by sort_order`;
  for (const b of blocks) console.log('   ', b.block_code, '| en', b.enabled, '|', JSON.stringify(b.params));
}
await sql.end();
