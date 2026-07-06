// Пилот дистилляции: 25 звонков (новый клиент + удачная сделка) → единицы знания для РАГ.
// Переопределяет роли по смыслу, отсеивает не-продажи. Throwaway.
// Запуск: node scratch/sales_kb_extract_pilot.mjs
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 3 });
const OPENAI_KEY = env.OPENAI_API_KEY;

const SYSTEM = `Ты — методист отдела продаж завода металлоконструкций (ЗМК). На входе расшифровка телефонного разговора. ВНИМАНИЕ: метки ролей "Менеджер:"/"Клиент:" в тексте часто проставлены НЕВЕРНО — не доверяй им, определяй роли сам по смыслу.

Правила определения ролей:
- МЕНЕДЖЕР — тот, кто представляется от компании ("Компания ЗМК", "ЗМК, добрый день"), отвечает на вопросы о товаре/заказе/цене, ведёт по сделке.
- КЛИЕНТ — звонящий с запросом, вопросом, проблемой.
- Если понять кто есть кто невозможно — role_confidence: "low".

Классифицируй разговор:
- "sales" — есть обсуждение товара, заказа, цены, условий, возражений, покупки.
- "non_sales" — просто маршрутизация ("соедините с…"), жалоба/претензия, логистика/доставка уже оплаченного, спам, пустой/короткий.

Если call_class="sales" И role_confidence="high" — извлеки массив units (единиц знания для обучения бота-продажника). Каждая:
- type: "objection" (возражение клиента и отработка), "product_qa" (вопрос о товаре и ответ), "pitch" (удачный приём подачи/закрытия), "pricing" (работа с ценой/скидкой).
- customer_utterance: суть реплики/ситуации КЛИЕНТА (по ней бот будет искать похожее) — перефразируй чисто, без мусора STT.
- manager_response: как ответил МЕНЕДЖЕР — то полезное, что бот должен перенять.
- comment: коротко чем приём ценен.
Бери только содержательные приёмы. Приветствия/«секунду подождите» НЕ бери. Если содержательного нет — units: [].

Ответь СТРОГО JSON: {"roles_swapped": bool, "call_class": "sales"|"non_sales", "role_confidence": "high"|"low", "units": [...]}`;

async function extract(call) {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Заказ ${call.order_number}, звонок ${call.event_id} (${call.direction}, ${call.duration_sec}с):\n\n${call.transcript}` },
    ],
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

try {
  // конфиг
  const cfg = await sql`SELECT DISTINCT ON (key) key, value FROM salary_config WHERE effective_from<=now() ORDER BY key, effective_from DESC`;
  const m = Object.fromEntries(cfg.map(r => [r.key, r.value]));
  const closing = m.closing_status.code, threshold = Number(m.permanent_client_threshold);

  // успешные заказы новых клиентов + транскрипт (как в воронке), берём 25 самых длинных транскриптов
  const rows = await sql`
    WITH succ AS (
      SELECT o.order_id, o.number,
             COALESCE(CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$' THEN (o.raw_payload->'customer'->>'id')::bigint END, o.client_id) AS client_id
      FROM orders o
      WHERE o.status=${closing} OR EXISTS (
        SELECT 1 FROM order_history_log h WHERE h.retailcrm_order_id=o.order_id AND h.field='status' AND h.new_value LIKE ${'%"code":"'+closing+'"%'})
    ),
    counts AS (SELECT client_id, count(*) c FROM succ WHERE client_id IS NOT NULL GROUP BY client_id),
    new_orders AS (SELECT s.number FROM succ s JOIN counts c ON c.client_id=s.client_id WHERE c.c <= ${threshold})
    SELECT DISTINCT ON (rt.event_id) rc.order_number, rt.event_id, rt.direction, rt.duration_sec, rt.transcript
    FROM retailcrm_calls rc
    JOIN raw_telphin_calls rt ON EXISTS (SELECT 1 FROM unnest(rt.record_uuids) u WHERE right(replace(u,'-',''),32)=rc.record_uuid)
    WHERE rc.order_number IN (SELECT number FROM new_orders)
      AND rt.transcription_status='completed' AND rt.transcript IS NOT NULL AND length(rt.transcript)>250
    ORDER BY rt.event_id, length(rt.transcript) DESC
    LIMIT 25`;

  console.log(`Извлекаю из ${rows.length} звонков…\n`);
  const out = [];
  let salesCnt = 0, unitCnt = 0, swappedCnt = 0, lowConf = 0;
  const byType = {};
  for (const call of rows) {
    try {
      const res = await extract(call);
      out.push({ call_id: call.event_id, order: call.order_number, ...res });
      if (res.roles_swapped) swappedCnt++;
      if (res.role_confidence === 'low') lowConf++;
      if (res.call_class === 'sales') salesCnt++;
      for (const u of res.units || []) { unitCnt++; byType[u.type] = (byType[u.type] || 0) + 1; }
      process.stdout.write(`  call ${call.event_id}: ${res.call_class}/${res.role_confidence}${res.roles_swapped ? '/роли↔' : ''} → ${(res.units || []).length} ед.\n`);
    } catch (e) {
      process.stdout.write(`  call ${call.event_id}: ОШИБКА ${e.message}\n`);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('ИТОГ ПИЛОТА');
  console.log(`  звонков обработано: ${out.length}`);
  console.log(`  классифицировано как продажи: ${salesCnt}  | не-продажи: ${out.length - salesCnt}`);
  console.log(`  роли были перепутаны (исправлено): ${swappedCnt}  | роли неясны (пропущено): ${lowConf}`);
  console.log(`  извлечено единиц знания: ${unitCnt}`);
  console.log(`  по типам:`, byType);

  console.log('\n' + '─'.repeat(70));
  console.log('ПРИМЕРЫ ИЗВЛЕЧЁННЫХ ЕДИНИЦ (то, что ляжет в РАГ):\n');
  let shown = 0;
  for (const c of out) for (const u of c.units || []) {
    if (shown++ >= 12) break;
    console.log(`[${u.type}] (заказ ${c.order}, call ${c.call_id})`);
    console.log(`  Клиент: ${u.customer_utterance}`);
    console.log(`  Менеджер: ${u.manager_response}`);
    if (u.comment) console.log(`  → ${u.comment}`);
    console.log('');
  }

  writeFileSync(new URL('./sales_kb_pilot_output.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log('Полный JSON: scratch/sales_kb_pilot_output.json');
} catch (e) { console.error('ОШИБКА:', e.message); console.error(e); }
finally { await sql.end(); }
