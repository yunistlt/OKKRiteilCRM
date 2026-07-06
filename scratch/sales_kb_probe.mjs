// Проба под РАГ бота-продажника: воронка «успешные сделки → только новые клиенты → есть транскрипт звонка».
// Throwaway. Запуск: node scratch/sales_kb_probe.mjs
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 3 });

const log = (...a) => console.log(...a);
const hr = () => log('─'.repeat(70));

try {
  // 0) Конфиг: закрывающий статус + порог постоянного клиента (последний действующий)
  const cfg = await sql`
    SELECT DISTINCT ON (key) key, value
    FROM salary_config
    WHERE effective_from <= now()
    ORDER BY key, effective_from DESC`;
  const cfgMap = Object.fromEntries(cfg.map(r => [r.key, r.value]));
  const closing = cfgMap.closing_status?.code;
  const threshold = cfgMap.permanent_client_threshold;
  hr();
  log('КОНФИГ');
  log('  closing_status =', closing);
  log('  permanent_client_threshold =', threshold, '(новый = успешных сделок клиента ≤ порога)');

  // 1) Все успешные заказы (дошли до закрывающего статуса хоть когда-то) + клиент из payload
  //    Считаем по всей истории: текущий статус ИЛИ переход в истории.
  const successful = await sql`
    WITH succ AS (
      SELECT o.order_id,
             o.number,
             o.created_at,
             o.totalsumm,
             COALESCE(
               CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                    THEN (o.raw_payload->'customer'->>'id')::bigint END,
               o.client_id
             ) AS client_id
      FROM orders o
      WHERE o.status = ${closing}
         OR EXISTS (
           SELECT 1 FROM order_history_log h
           WHERE h.retailcrm_order_id = o.order_id
             AND h.field = 'status'
             AND h.new_value LIKE ${'%"code":"' + closing + '"%'}
         )
    )
    SELECT * FROM succ`;
  log('');
  log('УСПЕШНЫЕ ЗАКАЗЫ (всего за всю историю):', successful.length);
  const withClient = successful.filter(o => o.client_id != null);
  log('  из них с идентифицированным клиентом:', withClient.length);

  // 2) Счётчик успешных сделок на клиента → классификация новый/постоянный
  const dealCount = new Map();
  for (const o of withClient) {
    const c = String(o.client_id);
    dealCount.set(c, (dealCount.get(c) || 0) + 1);
  }
  const newClientOrders = withClient.filter(o => (dealCount.get(String(o.client_id)) || 0) <= Number(threshold));
  const firstEverOrders = withClient.filter(o => (dealCount.get(String(o.client_id)) || 0) === 1);
  log('');
  log('ФИЛЬТР НОВИЗНЫ КЛИЕНТА');
  log('  заказы НОВЫХ клиентов (≤ порога):', newClientOrders.length);
  log('  заказы клиентов с ровно 1 успешной сделкой (строго первая покупка):', firstEverOrders.length);

  // 3) Связь с транскрибированными звонками (авторитетный путь RetailCRM)
  //    orders.number → retailcrm_calls.order_number → record_uuid ↔ raw_telphin_calls.record_uuids[]
  const newNumbers = newClientOrders.map(o => o.number).filter(Boolean);
  if (newNumbers.length === 0) {
    log('\n⚠ Нет order.number у новых заказов — проверь колонку.');
  } else {
    const linked = await sql`
      SELECT DISTINCT rc.order_number,
             rt.event_id,
             rt.duration_sec,
             rt.direction,
             length(rt.transcript) AS transcript_len
      FROM retailcrm_calls rc
      JOIN raw_telphin_calls rt ON EXISTS (
        SELECT 1 FROM unnest(rt.record_uuids) u
        WHERE right(replace(u, '-', ''), 32) = rc.record_uuid
      )
      WHERE rc.order_number = ANY(${newNumbers})
        AND rt.transcription_status = 'completed'
        AND rt.transcript IS NOT NULL
        AND length(rt.transcript) > 100`;
    hr();
    log('ВОРОНКА ДЛЯ РАГ (новые клиенты + удачная сделка + готовый транскрипт)');
    const ordersWithCall = new Set(linked.map(r => r.order_number));
    log('  заказов новых клиентов со связанным транскриптом:', ordersWithCall.size);
    log('  всего транскрибированных звонков по ним:', linked.length);
    const inbound = linked.filter(r => /in/i.test(r.direction || '')).length;
    log('  входящих/исходящих:', inbound, '/', linked.length - inbound);
    const avgLen = linked.length ? Math.round(linked.reduce((s, r) => s + Number(r.transcript_len), 0) / linked.length) : 0;
    log('  средняя длина транскрипта (симв.):', avgLen);

    // Сэмпл: 3 транскрипта целиком, чтобы оценить качество ролей/диаризации
    const sampleIds = linked.slice(0, 3).map(r => r.event_id);
    if (sampleIds.length) {
      const samples = await sql`
        SELECT event_id, duration_sec, direction, transcript
        FROM raw_telphin_calls WHERE event_id = ANY(${sampleIds})`;
      hr();
      log('СЭМПЛ ТРАНСКРИПТОВ (оценить путаницу ролей):');
      for (const s of samples) {
        log(`\n■ call ${s.event_id} | ${s.direction} | ${s.duration_sec}s`);
        log(String(s.transcript).slice(0, 900));
        log('  …');
      }
    }
  }
} catch (e) {
  console.error('ОШИБКА:', e.message);
  console.error(e);
} finally {
  await sql.end();
}
