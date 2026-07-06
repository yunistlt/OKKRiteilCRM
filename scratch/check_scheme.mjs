import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const schemes = await sql`select id, code, name, effective_from, archived_at from salary_scheme where code='seller' order by effective_from`;
console.log('=== salary_scheme code=seller ===');
for (const s of schemes) console.log(s.id, '| eff', s.effective_from, '| arch', s.archived_at, '|', s.name);

for (const s of schemes) {
  const blocks = await sql`select block_code, enabled, sort_order, params from salary_scheme_block where scheme_id=${s.id} order by sort_order`;
  console.log(`\n--- blocks of scheme id=${s.id} (eff ${s.effective_from}) ---`);
  for (const b of blocks) console.log('  ', b.block_code, '| enabled', b.enabled, '| params', JSON.stringify(b.params));
}

// also the comp assignment for Матвеева
const comp = await sql`select manager_id, scheme_code, effective_from from salary_manager_comp where manager_id=98 order by effective_from`;
console.log('\n=== salary_manager_comp manager 98 ===', comp);
await sql.end();
