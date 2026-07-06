import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const period = await sql`select id,year,month,status from salary_period where year=2026 and month=6`;
console.log('PERIOD:', period);
const pid = period[0]?.id;

const rows = await sql`select manager_id, oklad, premia_zayavki, k_quality, total, computed_at, breakdown from salary_calc where period_id=${pid} and manager_id=98`;
for (const r of rows) {
  console.log('\n=== manager', r.manager_id, 'computed_at', r.computed_at, '===');
  console.log('premia_zayavki', r.premia_zayavki, 'total', r.total);
  const b = r.breakdown;
  console.log('counts:', JSON.stringify(b.counts));
  console.log('schemeCode:', b.schemeCode);
  console.log('countedOrders length:', (b.countedOrders||[]).length);
  console.log('countedOrders types:', (b.countedOrders||[]).map(o=>o.type));
  console.log('blockContributions:');
  for (const c of (b.blockContributions||[])) {
    console.log('   ', c.code, '|', c.kind, '|', c.explain);
  }
}
await sql.end();
