import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 3 });
const log = (...a) => console.log(...a);
try {
  log('== record_uuid в retailcrm_calls (примеры) ==');
  const a = await sql`SELECT record_uuid FROM retailcrm_calls WHERE record_uuid IS NOT NULL LIMIT 5`;
  a.forEach(r => log('  rc:', JSON.stringify(r.record_uuid)));
  log('== record_uuids[] в raw_telphin_calls (примеры) ==');
  const b = await sql`SELECT record_uuids FROM raw_telphin_calls WHERE array_length(record_uuids,1)>0 LIMIT 5`;
  b.forEach(r => log('  rt:', JSON.stringify(r.record_uuids)));

  log('\n== есть ли пересечение orders.number ↔ retailcrm_calls.order_number вообще ==');
  const ov = await sql`SELECT count(DISTINCT o.number) AS matched
    FROM orders o JOIN retailcrm_calls rc ON rc.order_number = o.number`;
  log('  совпавших номеров:', ov[0].matched);

  log('\n== диапазоны номеров ==');
  const r1 = await sql`SELECT min(number::bigint) lo, max(number::bigint) hi, count(*) c FROM orders WHERE number ~ '^\\d+$'`;
  log('  orders.number:', r1[0]);
  const r2 = await sql`SELECT min(order_number::bigint) lo, max(order_number::bigint) hi, count(*) c FROM retailcrm_calls WHERE order_number ~ '^\\d+$'`;
  log('  retailcrm_calls.order_number:', r2[0]);

  log('\n== call_order_matches: схема связи (retailcrm_order_id → orders.order_id?) ==');
  const cm = await sql`SELECT telphin_call_id, retailcrm_order_id, confidence_score FROM call_order_matches ORDER BY confidence_score DESC NULLS LAST LIMIT 5`;
  cm.forEach(r => log('  ', r));
  // связь call_order_matches.telphin_call_id -> raw_telphin_calls.telphin_call_id, есть транскрипт?
  log('\n== call_order_matches со связанным транскриптом (любой confidence) ==');
  const cmj = await sql`
    SELECT count(DISTINCT com.retailcrm_order_id) AS orders_with_transcript,
           count(*) AS call_rows
    FROM call_order_matches com
    JOIN raw_telphin_calls rt ON rt.telphin_call_id = com.telphin_call_id
    WHERE rt.transcription_status='completed' AND rt.transcript IS NOT NULL`;
  log('  ', cmj[0]);
  log('\n== то же, но confidence>=0.9 ==');
  const cmj2 = await sql`
    SELECT count(DISTINCT com.retailcrm_order_id) AS orders_with_transcript, count(*) AS call_rows
    FROM call_order_matches com
    JOIN raw_telphin_calls rt ON rt.telphin_call_id = com.telphin_call_id
    WHERE rt.transcription_status='completed' AND rt.transcript IS NOT NULL AND com.confidence_score>=0.9`;
  log('  ', cmj2[0]);

  // как retailcrm_order_id соотносится с orders? order_id или number?
  log('\n== retailcrm_order_id матчится на orders.order_id? ==');
  const link = await sql`SELECT
    (SELECT count(DISTINCT com.retailcrm_order_id) FROM call_order_matches com JOIN orders o ON o.order_id=com.retailcrm_order_id) AS by_order_id`;
  log('  ', link[0]);
} catch (e) { console.error('ОШИБКА:', e.message); }
finally { await sql.end(); }
