import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const ids = (await sql.unsafe(`SELECT id FROM incoming_emails WHERE from_email ILIKE '%webasyst%'`)).map(r=>r.id);
async function requeue(){ await sql.unsafe(`UPDATE incoming_emails SET status='new', email_type=NULL WHERE id = ANY($1) AND created_crm_order_number IS NULL`, [ids]); }
const rows = () => sql.unsafe(`SELECT subject, status, email_type, created_crm_order_number ord FROM incoming_emails WHERE id = ANY($1)`, [ids]);
console.log(new Date().toISOString(), `жду деплой ~150с (${ids.length} писем)`);
await sleep(150000);
await requeue(); console.log('переочередил');
for(let i=1;i<=22;i++){
  await sleep(30000);
  const r = await rows();
  const orders = r.filter(x=>x.ord).length;
  const noreply = r.filter(x=>x.email_type==='noreply').length;
  const pending = r.filter(x=>x.status==='new').length;
  console.log(`#${i} заказов=${orders} noreply(старый код)=${noreply} new=${pending}`);
  if(orders + r.filter(x=>x.status!=='new'&&x.email_type!=='noreply').length === ids.length && pending===0){
    console.log('\n=== ИТОГ ==='); for(const x of r) console.log(`${x.ord?('№'+x.ord):x.email_type} ← ${x.subject}`); break;
  }
  if(noreply>0){ await requeue(); console.log('  старый код ещё жив — переочередил снова'); }
}
console.log('ФИНАЛ:', JSON.stringify(await rows()));
await sql.end();
