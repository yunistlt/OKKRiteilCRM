import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const id = (await sql.unsafe(`SELECT id FROM incoming_emails WHERE from_email ILIKE '%webasyst%' AND subject ILIKE '%звонок%' ORDER BY received_at DESC LIMIT 1`))[0].id;
const row = () => sql.unsafe(`SELECT status, email_type, created_crm_order_number ord, assigned_manager_id mgr, left(reasoning,120) why FROM incoming_emails WHERE id='${id}'`).then(r=>r[0]);
console.log(new Date().toISOString(),'жду деплой ~150с');
await sleep(150000);
async function rq(){ await sql.unsafe(`UPDATE incoming_emails SET status='new', email_type=NULL WHERE id='${id}' AND created_crm_order_number IS NULL`); }
await rq(); console.log('переочередил форму');
for(let i=1;i<=20;i++){
  await sleep(30000);
  const r = await row();
  if(r.ord){ console.log(`✅ ЗАКАЗ №${r.ord} mgr=${r.mgr}\n   ${r.why}`); break; }
  console.log(`#${i} status=${r.status} type=${r.email_type}`);
  if(r.email_type==='not_request'||r.email_type==='noreply'){ await rq(); console.log('  ещё старый код — переочередил'); }
}
console.log('ФИНАЛ:', JSON.stringify(await row()));
await sql.end();
