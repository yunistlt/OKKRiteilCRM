import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const CLOSING='send-assembling';
const fmt=v=>Math.round(v).toLocaleString('ru-RU');

// true без-НДС: ao-zvto ÷1, иначе ÷1.05
function trueRev(site, items){ const div = site==='ao-zvto'?1:1.05; let s=0;
  for(const it of items??[]){ const qty=Number(it?.quantity??1)||0, price=Number(it?.prices?.[0]?.price ?? it?.initialPrice ?? 0)||0; s+=price*qty/div; } return s; }

const months=[]; for(let y=2025,m=7;!(y===2026&&m===7);m++){ if(m>12){m=1;y++;} months.push([y,m]); }
console.log('Месяц     | Выручка БЕЗ НДС (испр.) | в т.ч. ЗВТО | прежняя (как в CRM)');
let arr=[];
for(const [y,m] of months){
  const start=`${y}-${String(m).padStart(2,'0')}-01`; const ny=m===12?y+1:y, nm=m===12?1:m+1; const end=`${ny}-${String(nm).padStart(2,'0')}-01`;
  const rows=await sql.unsafe(`SELECT o.raw_payload->>'site' site, c.items FROM salary_counted_orders($1,$2,$3) c JOIN orders o ON o.order_id=c.order_id`,[start,end,CLOSING]);
  let corr=0, zvto=0, old=0;
  for(const r of rows){ const t=trueRev(r.site,r.items); corr+=t; if(r.site==='ao-zvto') zvto+=t;
    // old = with stored vatRate
    for(const it of r.items??[]){ const qty=Number(it?.quantity??1)||0, price=Number(it?.prices?.[0]?.price??it?.initialPrice??0)||0; const vr=parseFloat(it?.vatRate)||0; old+=price*qty/(vr===5?1.05:vr===20?1.2:1);} }
  arr.push({start,corr,zvto,old});
  console.log(`${start} | ${fmt(corr).padStart(22)} | ${fmt(zvto).padStart(10)} | ${fmt(old).padStart(16)}`);
}
const last6=arr.slice(-6); const sum6=last6.reduce((a,o)=>a+o.corr,0);
console.log('\nИСПРАВЛЕННЫЙ без НДС:');
console.log('Среднее 6 мес (янв–июнь):', fmt(sum6/6));
console.log('Среднее 3 мес (апр–июнь):', fmt(arr.slice(-3).reduce((a,o)=>a+o.corr,0)/3));
console.log('Июнь:', fmt(arr.at(-1).corr));
console.log('Среднее 12 мес:', fmt(arr.reduce((a,o)=>a+o.corr,0)/12));
await sql.end();
