import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

console.log('=== 53646 (Кулынченко) ===');
console.log(JSON.stringify((await sql.unsafe(`SELECT created_crm_order_number ord, status, email_type, assigned_manager_id mgr, to_char(received_at,'DD.MM HH24:MI') recv, to_char(updated_at,'DD.MM HH24:MI') upd FROM incoming_emails WHERE created_crm_order_number='53646'`))[0]));

console.log('\n=== pharmperspectiva: создавались ли заказы и когда (порог деплоя ~30.06 11:00 МСК / 08:00Z) ===');
const ph = await sql.unsafe(`SELECT created_crm_order_number ord, email_type, status, to_char(received_at,'DD.MM HH24:MI') recv, to_char(updated_at,'DD.MM HH24:MI') upd, left(reasoning,90) why
  FROM incoming_emails WHERE from_email='dmto@pharmperspectiva.ru' ORDER BY received_at DESC LIMIT 8`);
console.table(ph);

console.log('\n=== order_blocklist сейчас ===');
console.log(JSON.stringify((await sql.unsafe(`SELECT order_blocklist FROM email_intake_config`))[0]));

console.log('\n=== позиция 53646 в «последних 40 по received_at» (панель так сортирует) ===');
const rank = await sql.unsafe(`
  WITH r AS (SELECT created_crm_order_number ord, email_type, received_at,
    row_number() OVER (ORDER BY received_at DESC) rn
    FROM incoming_emails WHERE status IN ('classified','processed','error'))
  SELECT ord, email_type, rn, to_char(received_at,'DD.MM HH24:MI') recv FROM r WHERE ord IN ('53646','53647','53645','53643') OR rn<=3 ORDER BY rn`);
console.table(rank);
await sql.end();
