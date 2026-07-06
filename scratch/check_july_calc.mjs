import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const period = await sql`select id, year, month, status from salary_period where year=2026 and month=7`;
console.log('July 2026 Period:', period);

if (period.length > 0) {
  const pid = period[0].id;
  const calcs = await sql`
    select id, manager_id, oklad, total, computed_at, breakdown
    from salary_calc
    where period_id = ${pid} and manager_id = 98
  `;
  console.log('Salary Calc entries for July 2026 for mgr 98:', calcs);
  if (calcs.length > 0) {
    console.log('Breakdown blockContributions:', calcs[0].breakdown?.blockContributions);
    console.log('Breakdown countedOrders:', calcs[0].breakdown?.countedOrders);
  }
}

await sql.end();
