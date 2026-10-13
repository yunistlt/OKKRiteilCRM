import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^"|"$/g,'');
const sql = postgres(url, { ssl: 'require', max: 1 });

const byId = [
  ['okk_order_scores','order_id'], ['order_payments','order_id'], ['order_items','order_id'],
  ['order_history_log','retailcrm_order_id'], ['order_metrics','retailcrm_order_id'],
  ['call_order_matches','retailcrm_order_id'], ['order_priorities','order_id'],
  ['okk_violations','order_id'], ['outgoing_calls','order_id'], ['call_timeline','order_id'],
  ['sales_rop_task','order_id'], ['sales_task_advice','order_id'], ['sales_rop_task_result','order_id'],
  ['order_estimate_verdicts','retailcrm_order_id'], ['own_order_payments','order_id'],
  ['order_contracts','order_id'], ['okk_consultant_threads','order_id'], ['ai_routing_logs','order_id'],
];
console.log('=== колонки-идентификаторы: сколько значений не находится среди order_id ===');
for (const [t, c] of byId) {
  try {
    const [r] = await sql.unsafe(`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id = x."${c}"))::int orphan,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.number = x."${c}"::text AND o.order_id <> x."${c}"))::int looks_like_number
        FROM public."${t}" x WHERE x."${c}" IS NOT NULL`);
    if (r.orphan || r.looks_like_number) console.log(`${t}.${c}: всего ${r.total}, висячих ${r.orphan}, похоже на НОМЕР ${r.looks_like_number}`);
    else console.log(`${t}.${c}: всего ${r.total} — чисто`);
  } catch (e) { console.log(`${t}.${c}: ошибка ${e.message.slice(0,60)}`); }
}

const byNumber = [
  ['order_files','order_number'], ['order_tasks','order_number'], ['order_email_sends','order_number'],
  ['outgoing_emails','order_number'], ['order_mail_reads','order_number'], ['legal_matters','order_number'],
  ['incoming_emails','created_crm_order_number'], ['order_contracts','order_number'],
];
console.log('\n=== колонки-номера: сколько не находится среди номеров ===');
for (const [t, c] of byNumber) {
  try {
    const [r] = await sql.unsafe(`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.number = x."${c}"))::int orphan,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id::text = x."${c}" AND o.number <> x."${c}"))::int looks_like_id
        FROM public."${t}" x WHERE x."${c}" IS NOT NULL`);
    console.log(`${t}.${c}: всего ${r.total}, висячих ${r.orphan}, похоже на ID ${r.looks_like_id}`);
  } catch (e) { console.log(`${t}.${c}: ошибка ${e.message.slice(0,60)}`); }
}
await sql.end();
