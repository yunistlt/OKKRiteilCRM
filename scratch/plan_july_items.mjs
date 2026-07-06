import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const CLOSING='send-assembling';
const rows = await sql.unsafe(`SELECT order_id, totalsumm, items FROM salary_counted_orders('2026-06-01','2026-07-01',$1)`,[CLOSING]);

// distribution of vatRate across items
const vatCount={}; let itemsTotal=0;
let priceVsInitialDiff=0, discountSeen=0;
let sumPrice=0, sumInitial=0, sumDiscountTotal=0;
for(const r of rows){ for(const it of r.items??[]){ itemsTotal++;
  const vr = it?.vatRate; const k = JSON.stringify(vr); vatCount[k]=(vatCount[k]||0)+1;
  const qty=Number(it?.quantity??1)||0;
  const price=Number(it?.prices?.[0]?.price ?? it?.initialPrice ?? 0)||0;
  const init=Number(it?.initialPrice??0)||0;
  const dt=Number(it?.discountTotal??0)||0;
  sumPrice+=price*qty; sumInitial+=init*qty; sumDiscountTotal+=dt;
  if(price!==init) priceVsInitialDiff++;
  if(dt!==0) discountSeen++;
}}
console.log('Заказов:',rows.length,' позиций:',itemsTotal);
console.log('vatRate распределение:', JSON.stringify(vatCount));
console.log('позиций где price≠initialPrice (есть скидка в цене):', priceVsInitialDiff);
console.log('позиций с discountTotal≠0:', discountSeen);
console.log('Σ price*qty (цена позиции):', Math.round(sumPrice).toLocaleString('ru-RU'));
console.log('Σ initialPrice*qty (до скидки):', Math.round(sumInitial).toLocaleString('ru-RU'));
console.log('Σ discountTotal:', Math.round(sumDiscountTotal).toLocaleString('ru-RU'));

// one sample item raw
const sampleOrd = rows.find(r=>(r.items??[]).length);
console.log('\nПример позиции:', JSON.stringify(sampleOrd.items[0], null, 1).slice(0,800));

// sample order: totalsumm vs raw_payload fields
const ro = await sql.unsafe(`SELECT raw_payload->>'summ' s, raw_payload->>'totalSumm' ts, raw_payload->>'prepaySum' ps, totalsumm FROM orders WHERE order_id=$1`,[sampleOrd.order_id]);
console.log('order-level:', JSON.stringify(ro[0]));
await sql.end();
