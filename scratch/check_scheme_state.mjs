import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

console.log('=== ВСЕ версии схемы menedzhery (включая архив) ===');
const sc = await sql`select id, code, name, effective_from, archived_at, created_at
  from salary_scheme where code='menedzhery' order by effective_from`;
console.table(sc.map(s=>({id:s.id, eff:s.effective_from?.toISOString?.().slice(0,10), arch:!!s.archived_at, created:s.created_at?.toISOString?.().slice(0,19)})));

for (const s of sc){
  const blocks = await sql`select block_code, params, sort_order from salary_scheme_block where scheme_id=${s.id} order by sort_order`;
  console.log(`\n--- блоки версии id=${s.id} (eff ${s.effective_from?.toISOString?.().slice(0,10)}) ---`);
  for (const b of blocks) console.log(`   ${b.block_code}: ${JSON.stringify(b.params)}`);
}

console.log('\n=== Июнь 2026: salary_calc (что видят менеджеры) ===');
const cj = await sql`
  select c.manager_id, m.last_name, c.total, c.premia_zayavki, c.conv_bonus, c.k_team,
         c.breakdown->>'schemeCode' as scheme,
         jsonb_array_length(coalesce(c.breakdown->'blockContributions','[]'::jsonb)) as nblocks
  from salary_calc c
  join salary_period p on p.id=c.period_id
  left join managers m on m.id=c.manager_id
  where p.year=2026 and p.month=6 order by c.total desc`;
console.table(cj.map(r=>({fio:r.last_name, scheme:r.scheme, total:Math.round(r.total), premia:Math.round(r.premia_zayavki), nblocks:r.nblocks})));

// детально по верхней строке — какие блоки реально в расчёте
if (cj[0]){
  const det = await sql`select (breakdown->'blockContributions') as bc from salary_calc c
    join salary_period p on p.id=c.period_id where p.year=2026 and p.month=6 and c.manager_id=${cj[0].manager_id}`;
  console.log(`\n=== blockContributions июнь у ${cj[0].last_name} (что в сохранённом расчёте) ===`);
  for (const b of (det[0]?.bc||[])) console.log(`   ${b.code}: amount=${b.amount??'-'} mult=${b.multiplier??'-'} | ${(b.explain||'').slice(0,80)}`);
}

console.log('\n=== Период июнь: статус ===');
const per = await sql`select year, month, status, updated_at from salary_period where year=2026 and month in (6,7) order by month`;
console.table(per.map(p=>({ym:`${p.year}-${p.month}`, status:p.status, updated:p.updated_at?.toISOString?.().slice(0,19)})));

await sql.end();
