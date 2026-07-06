import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import postgres from 'postgres';
import { validateConfigValue, SALARY_CONFIG_KEYS, type SalaryConfig } from '@/lib/salary/config';
import { buildPeriodMetrics, type CountedOrderRow } from '@/lib/salary/metrics';
import { computeManagerSalary, businessDaysInMonth } from '@/lib/salary/engine';
import type { BlockInstance } from '@/lib/salary/blocks/types';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const YEAR = 2026, MONTH = 6, ASOF = '2026-06-01', MID = 98, SCHEME = 'menedzhery';

async function resolveConfig(asOf: string): Promise<SalaryConfig> {
  const rows = await sql`select key, value, effective_from from salary_config where effective_from <= ${asOf} order by effective_from desc`;
  const latest = new Map<string, unknown>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r.value);
  const cfg = {} as SalaryConfig;
  for (const key of SALARY_CONFIG_KEYS) { if (!latest.has(key)) throw new Error('missing '+key); (cfg as any)[key] = validateConfigValue(key, latest.get(key)); }
  return cfg;
}
async function loadBlocks(code: string, asOf: string): Promise<BlockInstance[]> {
  const rows = await sql`select b.block_code, b.params, b.enabled from salary_scheme s join salary_scheme_block b on b.scheme_id=s.id
    where s.code=${code} and s.archived_at is null and s.effective_from=(select max(effective_from) from salary_scheme s2 where s2.code=${code} and s2.effective_from<=${asOf}) order by b.sort_order`;
  return rows.filter(r=>r.enabled!==false).map(r=>({code:r.block_code, params:r.params??{}}));
}

(async () => {
  const config = await resolveConfig(ASOF);
  const start = ASOF, end = '2026-07-01', closing = config.closing_status.code;
  const rows = (await sql`select * from salary_counted_orders(${start},${end},${closing})`) as unknown as CountedOrderRow[];
  const clientIds = Array.from(new Set(rows.map(r=>r.client_id).filter((x):x is number=>x!=null)));
  const clientDeals = new Map<number,number>();
  if (clientIds.length){ const d=await sql`select * from salary_client_deal_counts(${sql.array(clientIds)}::bigint[],${closing})`; for(const r of d) clientDeals.set(Number(r.client_id),Number(r.deals)); }
  const inc = await sql`select * from salary_incoming_counts(${start},${end},${sql.array(config.source_exclusions)}::text[])`;
  const incomingByManager = new Map<number,number>(); for(const r of inc) if(r.manager_id!=null) incomingByManager.set(Number(r.manager_id),Number(r.incoming));
  const scores = await sql`select manager_id,total_score from okk_order_scores where eval_date>=${start} and eval_date<${end}`;
  const qa = new Map<number,{s:number;n:number}>(); for(const s of scores){ if(s.manager_id==null||s.total_score==null)continue; const id=Number(s.manager_id); const a=qa.get(id)??{s:0,n:0}; a.s+=Number(s.total_score); a.n++; qa.set(id,a);}
  const qualityByManager=new Map<number,number>(); for(const[id,a]of qa) qualityByManager.set(id,a.s/a.n);
  const duties = await sql`select manager_id,shifts,kind from salary_duty where work_date>=${start} and work_date<${end}`;
  const dutyByManager=new Map<number,number>(), workedDaysByManager=new Map<number,number>();
  for(const d of duties){ if(d.manager_id==null)continue; const id=Number(d.manager_id); if(d.kind==='worked_day') workedDaysByManager.set(id,(workedDaysByManager.get(id)??0)+Number(d.shifts)); else dutyByManager.set(id,(dutyByManager.get(id)??0)+Number(d.shifts)); }

  const metrics = buildPeriodMetrics({year:YEAR,month:MONTH,rows,clientDeals,incomingByManager,qualityByManager,dutyByManager,workedDaysByManager,config});
  const m = metrics.managers.find(x=>x.managerId===MID)!;
  const blocks = await loadBlocks(SCHEME, ASOF);
  const ctx = { year:YEAR, month:MONTH, businessDays:businessDaysInMonth(YEAR,MONTH), teamRevenueNoVat:metrics.teamRevenueNoVat, personalPlanTarget:null, departmentPlanTarget:null, managerGrade:null, categoryNames:{} };
  const res = computeManagerSalary(m, blocks, ctx as any, SCHEME);

  console.log('=== Матвеева (98) СВЕЖИЙ расчёт июнь 2026 (текущая модель, без записи) ===');
  console.log('premia_zayavki:', res.premiaZayavki, '| total:', res.total);
  console.log('counts:', JSON.stringify(res.breakdown.counts));
  console.log('countedOrders:', res.breakdown.countedOrders.length, '| types:', res.breakdown.countedOrders.map(o=>o.type).join(','));
  console.log('seller premia_zayavki params:', JSON.stringify(blocks.find(b=>b.code==='premia_zayavki')?.params));
  console.log('blockContributions:');
  for (const c of (res.breakdown.blockContributions||[])) console.log('   ', c.code, '|', (c as any).explain);
  console.log('\nteamRevenueNoVat:', Math.round(metrics.teamRevenueNoVat));
  await sql.end();
})().catch(e=>{console.error(e);process.exit(1);});
