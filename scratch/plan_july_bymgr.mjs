import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const CLOSING='send-assembling';
const fmt=v=>Math.round(v).toLocaleString('ru-RU');
function trueRev(site, items){ const div=site==='ao-zvto'?1:1.05; let s=0; for(const it of items??[]){ const qty=Number(it?.quantity??1)||0, price=Number(it?.prices?.[0]?.price??it?.initialPrice??0)||0; s+=price*qty/div;} return s; }

// participants
const parts = await sql.unsafe(`SELECT manager_id FROM salary_participant WHERE COALESCE(is_active,true)=true`).catch(()=>[]);
console.log('participants:', JSON.stringify(parts));

const months=[['2026',4],['2026',5],['2026',6]];
const byMgr={};
for(const [y,m] of months){
  const start=`${y}-${String(m).padStart(2,'0')}-01`; const nm=m===12?1:m+1, ny=m===12?+y+1:y; const end=`${ny}-${String(nm).padStart(2,'0')}-01`;
  const rows=await sql.unsafe(`SELECT c.manager_id mid, o.raw_payload->>'site' site, c.items FROM salary_counted_orders($1,$2,$3) c JOIN orders o ON o.order_id=c.order_id`,[start,end,CLOSING]);
  for(const r of rows){ const mid=r.mid??'(none)'; byMgr[mid] ??= {apr:0,may:0,jun:0,cnt:0}; const key=m===4?'apr':m===5?'may':'jun'; byMgr[mid][key]+=trueRev(r.site,r.items); byMgr[mid].cnt++; }
}
// names
const ids = Object.keys(byMgr).filter(x=>x!=='(none)');
const names = await sql.unsafe(`SELECT id, COALESCE(NULLIF(trim(concat_ws(' ',last_name,first_name)),''), name, email, id::text) nm FROM users WHERE id = ANY($1)`, [ids.map(Number)]).catch(async()=>{
  return await sql.unsafe(`SELECT manager_id id, manager_name nm FROM orders WHERE manager_id=ANY($1) GROUP BY 1,2`,[ids.map(Number)]).catch(()=>[]);
});
const nmap={}; for(const n of names) nmap[n.id]=n.nm;
console.log('\nМенеджер           | апр | май | июнь | Σ3мес | среднее/мес');
for(const mid of Object.keys(byMgr)){ const b=byMgr[mid]; const s=b.apr+b.may+b.jun;
  console.log(`${(nmap[mid]||mid).padEnd(18)} | ${fmt(b.apr)} | ${fmt(b.may)} | ${fmt(b.jun)} | ${fmt(s)} | ${fmt(s/3)}`);
}
await sql.end();
