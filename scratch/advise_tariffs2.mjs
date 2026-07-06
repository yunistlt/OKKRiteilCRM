import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

// Засчитанные заявки (доведено до производства) по месяцам через RPC
for (const [y,mo] of [[2026,3],[2026,4],[2026,5],[2026,6]]){
  const start = `${y}-${String(mo).padStart(2,'0')}-01`;
  const end = mo===12 ? `${y+1}-01-01` : `${y}-${String(mo+1).padStart(2,'0')}-01`;
  try {
    const r = await sql`select * from salary_counted_orders(${start}::date, ${end}::date, 'send-assembling')`;
    // count + revenue
    let cnt = r.length;
    let rev = 0;
    for (const x of r){ rev += Number(x.revenue_no_vat ?? x.total_summ ?? 0); }
    console.log(`${y}-${String(mo).padStart(2,'0')}: засчитано заявок=${cnt}, выручка(стр)≈${Math.round(rev).toLocaleString('ru-RU')}`);
  } catch(e){ console.log(`${y}-${mo} counted err`, e.message); }
}

// salary_calc для мая и июня
for (const [y,mo] of [[2026,5],[2026,6]]){
  console.log(`\n=== salary_calc ${y}-${mo} ===`);
  try {
    const calc = await sql`
      select c.manager_id, m.last_name, c.total, c.premia_zayavki, c.oklad, c.conv_bonus, c.k_team,
             c.breakdown->>'schemeCode' as scheme,
             (c.breakdown->'countedOrders') as orders_json
      from salary_calc c
      join salary_period p on p.id = c.period_id
      left join managers m on m.id = c.manager_id
      where p.year = ${y} and p.month = ${mo}
      order by c.total desc`;
    console.table(calc.map(r=>{
      let n=0; try { n = Array.isArray(r.orders_json)?r.orders_json.length:0; } catch{}
      return {fio:r.last_name, scheme:r.scheme, total:Math.round(r.total), premia:Math.round(r.premia_zayavki), oklad:Math.round(r.oklad), conv:Math.round(r.conv_bonus), k_team:r.k_team, заявок:n};
    }));
  } catch(e){ console.log('calc err', e.message); }
}

await sql.end();
