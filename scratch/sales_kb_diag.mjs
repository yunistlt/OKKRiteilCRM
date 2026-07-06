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
  log('== объёмы таблиц ==');
  const t = await sql`SELECT
    (SELECT count(*) FROM retailcrm_calls) rc,
    (SELECT count(*) FROM retailcrm_calls WHERE order_number IS NOT NULL) rc_with_order,
    (SELECT count(*) FROM retailcrm_calls WHERE record_uuid IS NOT NULL) rc_with_uuid,
    (SELECT count(*) FROM raw_telphin_calls) rt,
    (SELECT count(*) FROM raw_telphin_calls WHERE transcription_status='completed' AND transcript IS NOT NULL) rt_done,
    (SELECT count(*) FROM raw_telphin_calls WHERE record_uuids IS NOT NULL AND array_length(record_uuids,1)>0) rt_with_uuid`;
  log(t[0]);

  log('\n== формат orders.number vs retailcrm_calls.order_number ==');
  const on = await sql`SELECT number FROM orders WHERE number IS NOT NULL LIMIT 5`;
  log('orders.number примеры:', on.map(r => r.number));
  const rcn = await sql`SELECT order_number FROM retailcrm_calls WHERE order_number IS NOT NULL LIMIT 5`;
  log('retailcrm_calls.order_number примеры:', rcn.map(r => r.order_number));

  log('\n== пересечение record_uuid (rc) ↔ record_uuids[] (rt) ==');
  const j = await sql`
    SELECT count(*) AS matched
    FROM retailcrm_calls rc
    JOIN raw_telphin_calls rt ON rt.record_uuids && ARRAY[rc.record_uuid]`;
  log('звонков, где record_uuid стыкуется:', j[0].matched);

  log('\n== retailcrm_calls с заказом И транскриптом (без фильтра новизны) ==');
  const k = await sql`
    SELECT count(DISTINCT rc.order_number) AS orders_with_transcript
    FROM retailcrm_calls rc
    JOIN raw_telphin_calls rt ON rt.record_uuids && ARRAY[rc.record_uuid]
    WHERE rc.order_number IS NOT NULL
      AND rt.transcription_status='completed' AND rt.transcript IS NOT NULL`;
  log(k[0]);

  log('\n== альтернативная связь: эвристический матчинг call_order_matches ==');
  const cm = await sql`SELECT
    (SELECT count(*) FROM call_order_matches) total,
    (SELECT count(*) FROM call_order_matches WHERE confidence_score >= 0.9) hi`;
  log(cm[0]);
} catch (e) { console.error('ОШИБКА:', e.message); }
finally { await sql.end(); }
