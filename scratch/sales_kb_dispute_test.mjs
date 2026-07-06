// Прицельный тест границы «спорное → юрист»: берём звонки с признаками спора и проверяем,
// что роутер ставит домен рекламация/возврат/суд и bot_can_answer=false (вычисляем в коде).
// Throwaway. Запуск: node scratch/sales_kb_dispute_test.mjs
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const sql = postgres(env.DATABASE_URL, { ssl: 'require', max: 3 });
const OPENAI_KEY = env.OPENAI_API_KEY;

// Источник истины для разрешения боту — В КОДЕ, не у LLM.
const BOT_DOMAINS = new Set(['продажа', 'товар', 'логистика_сроки']);
const deriveBotCanAnswer = (domain) => BOT_DOMAINS.has(domain);

const SYSTEM = readFileSync(new URL('./_extractor_prompt.txt', import.meta.url), 'utf8');

async function extract(call) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Звонок ${call.event_id}:\n\n${call.transcript}` }] }),
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status);
  return JSON.parse((await r.json()).choices[0].message.content);
}

try {
  // Звонки с лексическими признаками спора
  const rows = await sql`
    SELECT event_id, direction, duration_sec, transcript
    FROM raw_telphin_calls
    WHERE transcription_status='completed' AND transcript IS NOT NULL AND length(transcript) > 300
      AND (transcript ILIKE '%суд%' OR transcript ILIKE '%претензи%' OR transcript ILIKE '%верн%деньг%'
           OR transcript ILIKE '%возврат%' OR transcript ILIKE '%брак%' OR transcript ILIKE '%рекламаци%'
           OR transcript ILIKE '%юрист%' OR transcript ILIKE '%неустойк%')
    ORDER BY random()
    LIMIT 18`;
  console.log(`Прицельный тест: ${rows.length} звонков с признаками спора\n`);

  const out = [];
  let correctRoute = 0, leak = 0;
  for (const call of rows) {
    try {
      const res = await extract(call);
      const dom = res.primary_domain;
      const isDispute = ['рекламация', 'возврат', 'суд_претензия'].includes(dom);
      // bot_can_answer вычисляем в коде из домена КАЖДОГО юнита
      const units = (res.units || []).map(u => ({ ...u, bot_can_answer: deriveBotCanAnswer(u.domain) }));
      out.push({ call_id: call.event_id, ...res, units });
      // утечка = в спорном звонке есть юнит, который бот считает «своим»
      const leaked = isDispute && units.some(u => u.bot_can_answer);
      if (leaked) leak++;
      const flag = BOT_DOMAINS.has(dom) ? '🟢бот' : (dom === 'прочее' ? '⚪' : '🔴ЮРИСТ');
      console.log(`  call ${call.event_id}: ${dom} ${flag} /${res.role_confidence} → ${units.length} ед.${leaked ? '  ⚠️УТЕЧКА' : ''}`);
    } catch (e) { console.log(`  call ${call.event_id}: ОШИБКА ${e.message}`); }
  }

  const line = '─'.repeat(70);
  const disputeCalls = out.filter(c => ['рекламация', 'возврат', 'суд_претензия'].includes(c.primary_domain));
  console.log('\n' + line + '\nИТОГ ГРАНИЦЫ');
  console.log('  всего звонков:', out.length);
  console.log('  распознано как СПОР (→ юрист):', disputeCalls.length);
  console.log('  утечек (спорный звонок, а юнит помечен «бот может»):', leak);
  console.log('  домены:', out.reduce((a, c) => (a[c.primary_domain] = (a[c.primary_domain] || 0) + 1, a), {}));

  console.log('\n' + line + '\n🔴 ПРИМЕРЫ СПОРНЫХ (как роутер их видит):\n');
  disputeCalls.slice(0, 5).forEach(c => {
    console.log(`call ${c.call_id}: ${c.primary_domain}`);
    (c.units || []).slice(0, 2).forEach(u => {
      console.log(`  [${u.domain}/${u.type}] bot_can_answer=${u.bot_can_answer}`);
      console.log(`    Клиент: ${u.customer_utterance}`);
      console.log(`    Менеджер: ${u.manager_response}`);
    });
    console.log('');
  });

  writeFileSync(new URL('./sales_kb_dispute_output.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log('JSON: scratch/sales_kb_dispute_output.json');
} catch (e) { console.error('ОШИБКА:', e.message); console.error(e); }
finally { await sql.end(); }
