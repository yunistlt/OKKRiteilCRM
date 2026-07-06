import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

for (const [y,mo] of [[2026,6],[2026,5]]){
  console.log(`\n=== breakdown blockContributions ${y}-${mo} ===`);
  const rows = await sql`
    select m.last_name, (c.breakdown->'blockContributions') as bc
    from salary_calc c
    join salary_period p on p.id = c.period_id
    left join managers m on m.id = c.manager_id
    where p.year=${y} and p.month=${mo}
    order by c.total desc`;
  for (const r of rows){
    console.log(`-- ${r.last_name}`);
    if (Array.isArray(r.bc)){
      for (const b of r.bc){
        console.log(`   ${b.code}: amount=${b.amount ?? '-'} mult=${b.multiplier ?? '-'} | ${(b.explain||'').slice(0,90)}`);
      }
    } else console.log('   (нет blockContributions)');
  }
}
await sql.end();
