import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

const CLOSING = 'send-assembling';
const NDS = [{divisor:1,vat_pct:0},{divisor:1.05,vat_pct:5},{divisor:1.2,vat_pct:20}];
const vatDiv = (v) => { const n = typeof v==='number'?v:parseFloat(String(v??'')); if(!Number.isFinite(n)) return 1; const r=NDS.find(x=>x.vat_pct===n); return r?r.divisor:1; };
function revNoVat(items){ let s=0; for(const it of items??[]){ const qty=Number(it?.quantity??1)||0; const price=Number(it?.prices?.[0]?.price ?? it?.initialPrice ?? 0)||0; s+= price*qty/vatDiv(it?.vatRate);} return s; }

const months = [];
for(let y=2025,m=7; !(y===2026&&m===7); m++){ if(m>12){m=1;y++;} months.push([y,m]); }

const fmt = n => Math.round(n).toLocaleString('ru-RU');
console.log('Месяц        |  Заказов |  Выручка без НДС (₽) | totalsumm с НДС (₽)');
const out=[];
for(const [y,m] of months){
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const ny = m===12?y+1:y, nm = m===12?1:m+1;
  const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
  const rows = await sql.unsafe(`SELECT totalsumm, items FROM salary_counted_orders($1,$2,$3)`, [start,end,CLOSING]);
  let rev=0, tot=0; for(const r of rows){ rev+=revNoVat(r.items); tot+=Number(r.totalsumm)||0; }
  out.push({y,m,cnt:rows.length,rev,tot});
  console.log(`${start} | ${String(rows.length).padStart(7)} | ${fmt(rev).padStart(18)} | ${fmt(tot).padStart(16)}`);
}
const last3 = out.slice(-4,-1); // last 3 complete-ish months excl current June
const avg6 = out.slice(-7,-1).reduce((a,o)=>a+o.rev,0)/6;
console.log('\nСредняя выручка без НДС за последние 6 завершённых мес (без июня тек.):', fmt(avg6));
console.log('Средняя за последние 3 (мар-май):', fmt(out.slice(-4,-1).reduce((a,o)=>a+o.rev,0)/3));
await sql.end();
