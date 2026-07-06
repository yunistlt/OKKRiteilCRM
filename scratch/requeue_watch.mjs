import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const ID = 'e8e8dd29-5c64-4830-b4f5-695e3154c107';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function row(){ return sql.unsafe(`SELECT status,email_type,created_crm_order_number,reasoning FROM incoming_emails WHERE id='${ID}'`).then(r=>r[0]); }

console.log(new Date().toISOString(), 'старт: жду деплой ~150с перед первой переочередью');
await sleep(150000);

for (let i=1; i<=20; i++){
  const r = await row();
  if (r?.created_crm_order_number){
    console.log(`✅ ЗАКАЗ СОЗДАН: №${r.created_crm_order_number} | type=${r.email_type} | ${r.reasoning?.slice(-120)}`);
    break;
  }
  // переочередь только если письмо не в очереди (иначе ждём, пока воркер заберёт)
  if (r?.status !== 'new'){
    await sql.unsafe(`UPDATE incoming_emails SET status='new', email_type=NULL, updated_at=now() WHERE id='${ID}' AND created_crm_order_number IS NULL`);
    console.log(`#${i} переочередил (был status=${r?.status}, type=${r?.email_type})`);
  } else {
    console.log(`#${i} в очереди (status=new) — жду воркер`);
  }
  await sleep(30000);
}
const fin = await row();
console.log('ФИНАЛ:', JSON.stringify(fin));
await sql.end();
