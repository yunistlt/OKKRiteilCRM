import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const ID = 'e8e8dd29-5c64-4830-b4f5-695e3154c107';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const row = () => sql.unsafe(`SELECT status,email_type,created_crm_order_number,assigned_manager_id,left(reasoning,160) reasoning FROM incoming_emails WHERE id='${ID}'`).then(r=>r[0]);

// первая переочередь сразу (деплой уже живой)
await sql.unsafe(`UPDATE incoming_emails SET status='new', email_type=NULL, updated_at=now() WHERE id='${ID}' AND created_crm_order_number IS NULL`);
console.log(new Date().toISOString(), 'переочередил → status=new, жду крон (раз в 5 мин)');

for (let i=1;i<=26;i++){           // ~13 мин
  await sleep(30000);
  const r = await row();
  if (r?.created_crm_order_number){
    console.log(`✅ ЗАКАЗ СОЗДАН №${r.created_crm_order_number} | менеджер=${r.assigned_manager_id} | ${r.reasoning?.slice(-120)}`);
    break;
  }
  if (r?.status !== 'new' && r?.email_type === 'not_request'){
    await sql.unsafe(`UPDATE incoming_emails SET status='new', email_type=NULL, updated_at=now() WHERE id='${ID}' AND created_crm_order_number IS NULL`);
    console.log(`#${i} старый код уронил в not_request — переочередил снова`);
  } else {
    console.log(`#${i} status=${r?.status} type=${r?.email_type}`);
  }
}
console.log('ИТОГ:', JSON.stringify(await row()));
await sql.end();
