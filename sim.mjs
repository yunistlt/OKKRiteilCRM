import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, {ssl:'require'});
const rows = await sql`
  select p.year, p.month, p.status, c.manager_id, c.total, c.breakdown
  from salary_calc c join salary_period p on p.id = c.period_id
  where (p.year, p.month) in ((2026,7),(2026,8),(2026,9)) order by p.year, p.month, c.manager_id`;
const names = Object.fromEntries((await sql`select id, first_name, last_name from managers`).map(m=>[m.id, `${m.last_name} ${m.first_name}`]));
const fmt = n => Math.round(n).toLocaleString('ru-RU');

for (const r of rows) {
  const cs = r.breakdown?.blockContributions ?? [];
  if (!cs.length) { console.log(`${r.month}.${r.year} ${names[r.manager_id]}: разбивки нет`); continue; }
  const sum = g => cs.filter(c=>c.kind!=='multiplier'&&c.kind!=='penalty'&&c.group===g).reduce((s,c)=>s+(c.amount||0),0);
  const prod = (scope, skip) => cs.filter(c=>c.kind==='multiplier'&&c.multiplierScope===scope&&c.code!==skip).reduce((p,c)=>p*(c.multiplier??1),1);
  const base=sum('base'), premia=sum('premia'), variable=sum('variable'), flat=sum('flat');
  const penalty = cs.filter(c=>c.kind==='penalty').reduce((s,c)=>s+(c.amount||0),0);
  const mPremia = prod('premia'), mTeam = prod('variableBracket'), mTeamNoPlan = prod('variableBracket','plan_coef');
  const planK = cs.find(c=>c.code==='plan_coef')?.multiplier;
  const now = base + (premia*mPremia + variable)*mTeam + flat + penalty;
  const A   = base + premia*mPremia*mTeamNoPlan + variable*mTeam + flat + penalty;
  console.log(`${String(r.month).padStart(2,'0')}.${r.year} ${(names[r.manager_id]||r.manager_id).padEnd(20)} план×${planK ?? '—'}  сейчас ${fmt(now).padStart(9)} ₽  вариант А ${fmt(A).padStart(9)} ₽  разница ${(A-now>=0?'+':'')}${fmt(A-now)} ₽   (в базе ${fmt(r.total)})`);
}
await sql.end();
