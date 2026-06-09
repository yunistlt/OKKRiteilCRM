import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { buildPeriodMetrics, type CountedOrderRow } from '@/lib/salary/metrics';
import { computePeriodSalary } from '@/lib/salary/engine';
import { validateConfigValue, SALARY_CONFIG_KEYS } from '@/lib/salary/config';
const start='2026-05-01', end='2026-06-01';
(async () => {
  const sql = postgres(process.env.DATABASE_URL!);
  const crows = await sql`SELECT key, value FROM salary_config WHERE effective_from <= '2026-12-01' ORDER BY effective_from DESC`;
  const latest=new Map<string,any>(); for(const r of crows) if(!latest.has(r.key)) latest.set(r.key,r.value);
  const config:any={}; for(const k of SALARY_CONFIG_KEYS) config[k]=validateConfigValue(k as any,latest.get(k));
  const closing=config.closing_status.code;
  const rows=await sql`SELECT * FROM salary_counted_orders(${start},${end},${closing})` as unknown as CountedOrderRow[];
  const cids=Array.from(new Set(rows.map(r=>r.client_id).filter(Boolean))) as number[];
  const clientDeals=new Map<number,number>(); if(cids.length){const d=await sql`SELECT * FROM salary_client_deal_counts(${cids as any},${closing})`; for(const x of d) clientDeals.set(Number(x.client_id),Number(x.deals));}
  const inc=await sql`SELECT * FROM salary_incoming_counts(${start},${end},${config.source_exclusions as any})`;
  const incomingByManager=new Map<number,number>(); for(const r of inc) incomingByManager.set(Number(r.manager_id),Number(r.incoming));
  const sc=await sql`SELECT manager_id,total_score FROM okk_order_scores WHERE eval_date>=${start} AND eval_date<${end}`;
  const ag=new Map<number,{s:number,n:number}>(); for(const s of sc){if(s.manager_id==null||s.total_score==null)continue;const a=ag.get(Number(s.manager_id))??{s:0,n:0};a.s+=Number(s.total_score);a.n++;ag.set(Number(s.manager_id),a);}
  const qualityByManager=new Map<number,number>(); for(const [m,a] of Array.from(ag)) qualityByManager.set(m,a.s/a.n);
  await sql.end();
  const pm=buildPeriodMetrics({year:2026,month:5,rows,clientDeals,incomingByManager,qualityByManager,dutyByManager:new Map(),config});
  const ps=computePeriodSalary(pm,config);
  console.log(`МАЙ 2026: заказов=${rows.length}, выручка отдела без НДС=${Math.round(ps.teamRevenueNoVat).toLocaleString('ru')} → К_команды=${ps.kTeam}\n`);
  let fot=0;
  for(const r of ps.results){fot+=r.total;
    console.log(`Менеджер ${r.managerId}: ${Math.round(r.total).toLocaleString('ru')} ₽ | прем=${r.premiaZayavki}×${r.kQuality} конв=${r.convBonus} скид=${r.discountBonus} [new=${r.breakdown.counts.new} perm=${r.breakdown.counts.permanent} печь=${r.breakdown.counts.pech_vto}] кач=${r.breakdown.qualityScore?.toFixed(0)??'—'} скид%=${r.breakdown.discountValue??'—'}`);
  }
  console.log(`\nФОТ отдела за май: ${Math.round(fot).toLocaleString('ru')} ₽`);
  process.exit(0);
})();
