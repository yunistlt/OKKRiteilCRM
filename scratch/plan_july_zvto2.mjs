import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const CLOSING='send-assembling';
// counted orders 12 mo with site + items
const rows = await sql.unsafe(`
  SELECT o.raw_payload->>'site' site, c.totalsumm, c.items
  FROM salary_counted_orders('2025-07-01','2026-07-01',$1) c
  JOIN orders o ON o.order_id=c.order_id`,[CLOSING]);

// cross-tab: site -> vatRate counts & turnover
const tab={};
for(const r of rows){ const site=r.site||'(null)';
  for(const it of r.items??[]){ const vr=String(it?.vatRate);
    const qty=Number(it?.quantity??1)||0, price=Number(it?.prices?.[0]?.price ?? it?.initialPrice ?? 0)||0;
    tab[site] ??= {}; tab[site][vr] ??= {n:0,sum:0}; tab[site][vr].n++; tab[site][vr].sum+=price*qty;
  }}
const fmt=v=>Math.round(v).toLocaleString('ru-RU');
for(const site of Object.keys(tab)){
  console.log('site='+site);
  for(const vr of Object.keys(tab[site])) console.log('   vat'+vr+': n='+tab[site][vr].n+'  Σ='+fmt(tab[site][vr].sum));
}
await sql.end();
