// Экстрактор v2: 6 доменов + bot_can_answer + жёсткий отбор. Сэмпл по всему корпусу.
// Throwaway. Запуск: node scratch/sales_kb_extract_v2.mjs [N]
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 3 });
const OPENAI_KEY = env.OPENAI_API_KEY;
const N = Number(process.argv[2] || 40);

// Домены, в которых боту РАЗРЕШЕНО отвечать самому:
const BOT_DOMAINS = new Set(['продажа', 'товар', 'логистика_сроки']);

const SYSTEM = `Ты — методист отдела продаж завода металлоконструкций (ЗМК). Анализируешь расшифровку телефонного разговора и извлекаешь переносимые знания для базы.

ВАЖНО ПРО РОЛИ: метки "Менеджер:"/"Клиент:" в тексте часто НЕВЕРНЫ — определяй роли сам по смыслу.
- МЕНЕДЖЕР — представляется от компании ("Компания ЗМК", "ЗМК, добрый день"), отвечает про товар/заказ/цену, ведёт сделку.
- КЛИЕНТ — звонящий с запросом/проблемой.
- Если кто есть кто неясно — role_confidence:"low" (units оставь пустым).

ДОМЕН разговора (primary_domain) — один из:
- "продажа" — выбор/обсуждение покупки, возражения, цена, закрытие сделки.
- "товар" — вопросы о характеристиках/ассортименте/что производим/что перепродаём.
- "логистика_сроки" — сроки изготовления, доставка, отгрузка.
- "рекламация" — жалоба на качество/брак/недокомплект уже полученного.
- "возврат" — требование вернуть деньги, отказ от заказа с деньгами.
- "суд_претензия" — упоминание суда, юриста, официальной претензии, судебного решения.
- "прочее" — маршрутизация ("соедините с…"), спам, пустое, нерелевантное.

ГРАНИЦА БОТА: бот-продажник отвечает САМ только в доменах продажа/товар/логистика_сроки. В рекламация/возврат/суд_претензия бот НЕ отвечает — передаёт юристу. Поэтому проставляй bot_can_answer соответственно домену юнита.

ИЗВЛЕЧЕНИЕ units — массив переносимых единиц знания. Бери ТОЛЬКО если ответ менеджера несёт перенос. ценность: факт, аргумент, отработку возражения, логику цены, признак ситуации. НЕ бери "Да", "Здравствуйте", "секунду подождите", пустые подтверждения. Если ценного нет — units:[].
Каждый unit:
- domain: один из доменов выше.
- type: краткий тип ("возражение_цена","возражение_срок","характеристика_товара","ассортимент","срок_изготовления","доставка","сигнал_рекламации","сигнал_возврата","сигнал_суд","приём_закрытия" и т.п.).
- bot_can_answer: true если domain ∈ {продажа,товар,логистика_сроки}, иначе false.
- customer_utterance: суть реплики/ситуации КЛИЕНТА, чисто перефразируй (по ней будет поиск).
- manager_response: что полезного сделал/сказал МЕНЕДЖЕР (для разрешённых доменов — образец ответа; для спорных — как ситуация выглядит/как передавали).
- comment: чем ценно (1 фраза).

Ответь СТРОГО JSON: {"primary_domain":"...","roles_swapped":bool,"role_confidence":"high"|"low","units":[...]}`;

async function extract(call) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Звонок ${call.event_id} (${call.direction}, ${call.duration_sec}с):\n\n${call.transcript}` },
      ],
    }),
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return JSON.parse((await r.json()).choices[0].message.content);
}

try {
  // Сэмпл по ВСЕМУ корпусу готовых транскриптов (не только продажи)
  const rows = await sql`
    SELECT event_id, direction, duration_sec, transcript
    FROM raw_telphin_calls
    WHERE transcription_status='completed' AND transcript IS NOT NULL AND length(transcript) > 300
    ORDER BY random()
    LIMIT ${N}`;
  console.log(`Извлекаю из ${rows.length} звонков (весь корпус)…\n`);

  const out = [];
  const domainCnt = {}, unitDomainCnt = {};
  let botUnits = 0, lawyerUnits = 0, swapped = 0, lowConf = 0;
  for (const call of rows) {
    try {
      const res = await extract(call);
      out.push({ call_id: call.event_id, ...res });
      domainCnt[res.primary_domain] = (domainCnt[res.primary_domain] || 0) + 1;
      if (res.roles_swapped) swapped++;
      if (res.role_confidence === 'low') lowConf++;
      for (const u of res.units || []) {
        unitDomainCnt[u.domain] = (unitDomainCnt[u.domain] || 0) + 1;
        if (u.bot_can_answer) botUnits++; else lawyerUnits++;
      }
      const flag = BOT_DOMAINS.has(res.primary_domain) ? '🟢бот' : (res.primary_domain === 'прочее' ? '⚪' : '🔴юрист');
      console.log(`  call ${call.event_id}: ${res.primary_domain} ${flag} /${res.role_confidence}${res.roles_swapped ? '/роли↔' : ''} → ${(res.units || []).length} ед.`);
    } catch (e) {
      console.log(`  call ${call.event_id}: ОШИБКА ${e.message}`);
    }
  }

  const line = '─'.repeat(70);
  console.log('\n' + line + '\nИТОГ');
  console.log('  звонков:', out.length);
  console.log('  по доменам (primary):', domainCnt);
  console.log('  роли исправлены:', swapped, '| роли неясны (пропуск units):', lowConf);
  console.log('  юнитов всего:', botUnits + lawyerUnits, '| 🟢bot_can_answer:', botUnits, '| 🔴к юристу:', lawyerUnits);
  console.log('  юниты по доменам:', unitDomainCnt);

  // Примеры: отдельно «бот» и «юрист», чтобы оценить границу
  const allUnits = out.flatMap(c => (c.units || []).map(u => ({ ...u, call: c.call_id })));
  const show = (title, arr) => {
    console.log('\n' + line + '\n' + title + '\n');
    arr.slice(0, 6).forEach(u => {
      console.log(`[${u.domain}/${u.type}] call ${u.call}  (bot_can_answer=${u.bot_can_answer})`);
      console.log(`  Клиент: ${u.customer_utterance}`);
      console.log(`  Менеджер: ${u.manager_response}`);
      if (u.comment) console.log(`  → ${u.comment}`);
      console.log('');
    });
  };
  show('🟢 ЮНИТЫ ДЛЯ БОТА (продажа/товар/логистика):', allUnits.filter(u => u.bot_can_answer));
  show('🔴 ЮНИТЫ «К ЮРИСТУ» (рекламация/возврат/суд — для роутера/Legal, НЕ для ответов бота):', allUnits.filter(u => !u.bot_can_answer));

  writeFileSync(new URL('./sales_kb_v2_output.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log('Полный JSON: scratch/sales_kb_v2_output.json');
} catch (e) { console.error('ОШИБКА:', e.message); console.error(e); }
finally { await sql.end(); }
