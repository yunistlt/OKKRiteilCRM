// Воронка: заказы, дошедшие до продажи за последние 6 мес → их транскрибированные звонки.
// Throwaway. Запуск: node scratch/sales_kb_won6m_probe.mjs
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
  const cfg = await sql`SELECT DISTINCT ON (key) key, value FROM salary_config WHERE effective_from<=now() ORDER BY key, effective_from DESC`;
  const closing = Object.fromEntries(cfg.map(r => [r.key, r.value])).closing_status.code;
  log('closing_status =', closing, '| окно: последние 6 месяцев\n');

  // Выигранные заказы с датой закрытия (occurred_at перехода в closing), в окне 6 мес
  const won = await sql`
    WITH closed AS (
      SELECT o.order_id, o.number, o.totalsumm,
        COALESCE(
          (SELECT min(h.occurred_at) FROM order_history_log h
             WHERE h.retailcrm_order_id=o.order_id AND h.field='status'
               AND h.new_value LIKE ${'%"code":"'+closing+'"%'}),
          CASE WHEN o.status=${closing} THEN NULLIF(o.raw_payload->>'statusUpdatedAt','')::timestamptz END
        ) AS closed_at
      FROM orders o
      WHERE o.status=${closing} OR EXISTS (
        SELECT 1 FROM order_history_log h WHERE h.retailcrm_order_id=o.order_id AND h.field='status'
          AND h.new_value LIKE ${'%"code":"'+closing+'"%'})
    )
    SELECT * FROM closed WHERE closed_at >= now() - interval '6 months'`;
  log('Выигранных заказов за 6 мес:', won.length, `(~${(won.length/6).toFixed(0)}/мес)`);

  const numbers = won.map(w => w.number).filter(Boolean);
  // Их транскрибированные звонки (авторитетная связь + нормализованный uuid)
  const calls = await sql`
    SELECT DISTINCT rc.order_number, rt.event_id, rt.direction, rt.duration_sec, length(rt.transcript) AS len
    FROM retailcrm_calls rc
    JOIN raw_telphin_calls rt ON EXISTS (SELECT 1 FROM unnest(rt.record_uuids) u WHERE right(replace(u,'-',''),32)=rc.record_uuid)
    WHERE rc.order_number = ANY(${numbers})
      AND rt.transcription_status='completed' AND rt.transcript IS NOT NULL AND length(rt.transcript)>250`;
  const ordersWithCall = new Set(calls.map(c => c.order_number));
  log('  из них с ≥1 транскрибированным звонком:', ordersWithCall.size);
  log('  всего транскрибированных звонков по ним:', calls.length);
  const inb = calls.filter(c => /in/i.test(c.direction||'')).length;
  log('  входящих/исходящих:', inb, '/', calls.length - inb);
  const lens = calls.map(c=>Number(c.len)).sort((a,b)=>a-b);
  log('  длина транскрипта симв. (медиана/макс):', lens[Math.floor(lens.length/2)]||0, '/', lens[lens.length-1]||0);
  log('  звонков длиннее 250 симв (содержательных):', calls.length);
  log('\n→ Оценка экстракции:', calls.length, 'звонков × gpt-4o-mini ≈ $' + (calls.length*0.00035).toFixed(2));
} catch (e) { console.error('ОШИБКА:', e.message); console.error(e); }
finally { await sql.end(); }
