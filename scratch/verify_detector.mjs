import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });
const ms = s => s ? new Date(s).getTime() : NaN;
async function state(year, month){
  const per = await sql`select id, status from salary_period where year=${year} and month=${month}`;
  if(!per[0]) return `${year}-${month}: периода нет`;
  if(per[0].status!=='open') return `${year}-${month}: статус ${per[0].status} → не предлагаем пересчёт`;
  const cc = await sql`select computed_at from salary_calc where period_id=${per[0].id} order by computed_at desc limit 1`;
  const computedAt = cc[0]?.computed_at ?? null;
  if(!computedAt) return `${year}-${month}: расчёта нет (пустой экран)`;
  const endExcl = (month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`);
  const times=[];
  const slog = await sql`select created_at, new_value from salary_audit_log where entity in ('scheme','manager_comp') order by created_at desc limit 300`;
  for(const r of slog){ const eff=r.new_value?.effectiveFrom; if(!eff || String(eff).slice(0,10) < endExcl) times.push(r.created_at); }
  const clog = await sql`select created_at from salary_audit_log where entity in ('config','grade') order by created_at desc limit 1`;
  if(clog[0]) times.push(clog[0].created_at);
  const plans = await sql`select created_at, updated_at from salary_plan where year=${year} and month=${month}`;
  for(const p of plans){ if(p.created_at) times.push(p.created_at); if(p.updated_at) times.push(p.updated_at); }
  let changedAt=null; for(const t of times) if(!changedAt || ms(t)>ms(changedAt)) changedAt=t;
  const need = changedAt!=null && ms(changedAt)>ms(computedAt);
  return `${year}-${month}: computed=${computedAt?.toISOString?.().slice(0,19)} changed=${changedAt?.toISOString?.().slice(0,19)} → needsRecalc=${need}`;
}
console.log(await state(2026,6));
console.log(await state(2026,5));
console.log(await state(2026,7));
await sql.end();
