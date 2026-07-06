import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

// 1. Заявки (входящие = заказы, созданные за месяц) и выручка по месяцам
console.log('=== Заказы по месяцам (создано) ===');
try {
  const rows = await sql`
    select to_char(date_trunc('month', created_at),'YYYY-MM') as ym,
           count(*) as orders,
           count(*) filter (where status = 'send-assembling') as send_assembling_now,
           round(sum(coalesce((raw_payload->>'totalSumm')::numeric,0))) as total_summ
    from orders
    where created_at >= now() - interval '7 months'
    group by 1 order by 1`;
  console.table(rows);
} catch(e){ console.log('orders err', e.message); }

// 2. Реестр ОП — у кого назначена схема (актуально)
console.log('=== Реестр ОП (активные назначения схем) ===');
try {
  const reg = await sql`
    select c.manager_id, m.last_name, m.first_name, c.scheme_code, c.effective_from
    from salary_manager_comp c
    left join managers m on m.id = c.manager_id
    where c.effective_from <= current_date
    order by c.manager_id, c.effective_from`;
  console.table(reg);
} catch(e){ console.log('comp err', e.message); }

// 3. Схемы и их блоки с параметрами
console.log('=== Схемы (активные версии) ===');
try {
  const sc = await sql`select id, code, name, effective_from, archived_at from salary_scheme order by code, effective_from`;
  console.table(sc);
  console.log('=== Блоки схем с параметрами ===');
  const blocks = await sql`
    select s.code as scheme, b.block_code, b.params, b.sort_order
    from salary_scheme_block b
    join salary_scheme s on s.id = b.scheme_id
    where s.archived_at is null
    order by s.code, b.sort_order`;
  for (const b of blocks){
    console.log(`[${b.scheme}] ${b.block_code}:`, JSON.stringify(b.params));
  }
} catch(e){ console.log('scheme err', e.message); }

// 4. Базовый конфиг
console.log('=== salary_config (последний) ===');
try {
  const cfg = await sql`select effective_from, config from salary_config order by effective_from desc limit 1`;
  console.log(JSON.stringify(cfg[0]?.config, null, 2));
} catch(e){ console.log('config err', e.message); }

// 5. Последний посчитанный период — суммы ЗП по менеджерам
console.log('=== Последний salary_calc период ===');
try {
  const per = await sql`select year, month, status from salary_period order by year desc, month desc limit 3`;
  console.table(per);
  if (per[0]){
    const calc = await sql`
      select c.manager_id, m.last_name, c.total, c.premia_zayavki, c.oklad, c.conv_bonus, c.k_team
      from salary_calc c
      join salary_period p on p.id = c.period_id
      left join managers m on m.id = c.manager_id
      where p.year = ${per[0].year} and p.month = ${per[0].month}
      order by c.total desc`;
    console.table(calc.map(r=>({fio:r.last_name, total:Math.round(r.total), premia:Math.round(r.premia_zayavki), oklad:Math.round(r.oklad), conv:Math.round(r.conv_bonus), k_team:r.k_team})));
  }
} catch(e){ console.log('calc err', e.message); }

await sql.end();
