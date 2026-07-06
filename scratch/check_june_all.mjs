import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });
const rows = await sql`select c.manager_id, c.total, c.computed_at, c.breakdown->'counts' as counts,
  jsonb_array_length(coalesce(c.breakdown->'countedOrders','[]')) as orders, c.breakdown->>'schemeCode' as scheme
  from salary_calc c join salary_period p on p.id=c.period_id where p.year=2026 and p.month=6 order by c.manager_id`;
for (const r of rows) console.log('mgr',r.manager_id,'| computed',String(r.computed_at).slice(0,16),'| scheme',r.scheme,'| counts',JSON.stringify(r.counts),'| orders',r.orders,'| total',r.total);
await sql.end();
