import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const BLIND = ['62180309-9004-4c96-880f-62014c91333d','fe323afa-79a7-40d6-a59d-eeca18e065a0']; // smartfleet, tikhomirova

// переочередь: весь ошибочный пакет + слепые HTML-заявки, без уже созданных заказов
const upd = await sql.unsafe(`
  UPDATE incoming_emails SET status='new', email_type=NULL, forwarded_to=NULL, forwarded_department=NULL, forwarded_at=NULL
  WHERE created_crm_order_number IS NULL AND received_at >= now()-interval '2 days'
    AND (reasoning='Ошибка анализа' OR id = ANY($1))
  RETURNING id`, [BLIND]);
console.log(new Date().toISOString(), `переочередил ${upd.length} писем, жду прод-крон…`);

const start = Object.fromEntries((await sql.unsafe(`SELECT id, from_email FROM incoming_emails WHERE id = ANY($1)`, [upd.map(r=>r.id)])).map(r=>[r.id, r.from_email]));
for (let i=1;i<=20;i++){
  await sleep(30000);
  const rows = await sql.unsafe(`SELECT id, status, email_type, created_crm_order_number ord, reasoning='Ошибка анализа' err FROM incoming_emails WHERE id = ANY($1)`, [upd.map(r=>r.id)]);
  const pending = rows.filter(r=>r.status==='new').length;
  const orders = rows.filter(r=>r.ord).length;
  const errs = rows.filter(r=>r.err).length;
  console.log(`#${i} осталось new=${pending} | заказов=${orders} | ошибок=${errs}`);
  if (pending===0){
    console.log('\n=== ИТОГ переразбора ===');
    for (const r of rows) console.log(`${r.ord?('№'+r.ord+' ЗАКАЗ'):r.email_type}${r.err?' (ОШИБКА)':''} ← ${start[r.id]}`);
    break;
  }
}
await sql.end();
