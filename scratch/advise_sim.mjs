import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

// Предлагаемые тарифы
const P = {
  oklad: 30000,
  rate_new: 4500,
  rate_perm: 2500,
  conv_gate: 40,
  conv_tiers: [[35,22000],[30,16000],[25,10000],[20,6000],[0,0]], // мин% → бонус
  discount_threshold: 10, discount_bonus: 5000,
  // k_team — чистая надбавка за абсолютную выручку (вниз не штрафует)
  kteam_tiers: [[20000000,1.3],[16000000,1.15],[0,1.0]],
  // dept_plan_coef — за % выполнения плана отдела (вот он режет недобор)
  dept_plan: 12000000,
  deptplan_tiers: [[100,1.2],[90,0.9],[80,0.8],[70,0.7],[50,0.5],[0,0.3]], // мин % → коэф; ≥100% = повышающий 1,2
  // grade_multiplier — грейд менеджера множит переменную часть
  grade_k: {1:1.1, 2:1.05, 3:1.0},
};
// Назначение грейдов по фамилии (сценарий: 1/2/3)
const GRADE = { 'Матвеева':1, 'Парфенова':2, 'Гордеева':3, 'Хапилова':3 };
const pickTier = (v, tiers) => { for (const [min,val] of tiers) if (v>=min) return val; return tiers[tiers.length-1][1]; };

for (const [y,mo] of [[2026,5],[2026,6]]){
  console.log(`\n=== СИМУЛЯЦИЯ ${y}-${String(mo).padStart(2,'0')} (новые тарифы) ===`);
  const rows = await sql`
    select m.last_name, (c.breakdown->'blockContributions') as bc
    from salary_calc c
    join salary_period p on p.id = c.period_id
    left join managers m on m.id = c.manager_id
    where p.year=${y} and p.month=${mo} and (c.breakdown->>'schemeCode')='menedzhery'
    order by m.last_name`;
  let fot = 0, teamRev = 0;
  const out = [];
  for (const r of rows){
    const bc = r.bc || [];
    const find = code => bc.find(b=>b.code===code) || {};
    // извлекаем фактические метрики из explain
    const pz = find('premia_zayavki').explain || '';
    const mNew = +(pz.match(/Новых (\d+)/)||[])[1] || 0;
    const mPerm = +(pz.match(/Постоянных (\d+)/)||[])[1] || 0;
    const cv = find('conv_bonus').explain || '';
    const cm = cv.match(/Конверсия (\d+)\/(\d+) = ([\d.]+)%/) || [];
    const convNum = +cm[1]||0, convDen = +cm[2]||0, convPct = +cm[3]||0;
    const dv = find('discount_bonus').explain || '';
    const discPct = +((dv.match(/: ([\d.]+)%/)||[])[1]) || null;
    const kt = find('k_team').explain || '';
    teamRev = +((kt.match(/([\d\s ]+) ₽/)||[])[1]||'0').replace(/[\s ]/g,'') || teamRev;

    const premia = mNew*P.rate_new + mPerm*P.rate_perm;
    const conv = convDen >= P.conv_gate ? pickTier(convPct, P.conv_tiers) : 0;
    const disc = (discPct!=null && discPct <= P.discount_threshold) ? P.discount_bonus : 0;
    const kteam = pickTier(teamRev, P.kteam_tiers);
    const planPct = P.dept_plan>0 ? teamRev/P.dept_plan*100 : 100;
    const deptCoef = pickTier(planPct, P.deptplan_tiers);
    const gr = GRADE[r.last_name] ?? 3;
    const gradeK = P.grade_k[gr] ?? 1;
    const total = P.oklad + (premia + conv + disc) * kteam * deptCoef * gradeK;
    fot += total;
    out.push({fio:r.last_name, закрыто:`${mNew}н+${mPerm}п`, премия:premia, конв:`${convPct}%→${conv}`, скидка:disc, kteam, план:`${Math.round(planPct)}%→${deptCoef}`, грейд:`${gr}→×${gradeK}`, ИТОГО:Math.round(total)});
  }
  console.table(out);
  fot += 15000; // оператор колл-центра (оклад)
  const pct = teamRev>0 ? (fot/teamRev*100).toFixed(2) : '—';
  console.log(`ФОТ ОП (3 продавца + оператор 15к) = ${Math.round(fot).toLocaleString('ru-RU')} ₽ | выручка ${teamRev.toLocaleString('ru-RU')} ₽ | ФОТ = ${pct}%`);
}
await sql.end();
