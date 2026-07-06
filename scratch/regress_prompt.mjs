import postgres from 'postgres';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
const env = readFileSync('.env.local','utf8');
const get = k => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m ? m[1].trim().replace(/^["']|["']$/g,'') : ''; };
const sql = postgres(get('DATABASE_URL'), { ssl: 'require' });
const openai = new OpenAI({ apiKey: get('OPENAI_API_KEY') });
const dbPrompt = (await sql.unsafe(`SELECT system_prompt FROM ai_prompts WHERE key='email_secretary_classifier'`))[0].system_prompt;
const DIRECTIONAL = `

РАЗЛИЧАЙ НАПРАВЛЕНИЕ СДЕЛКИ, А НЕ ДОЛЖНОСТЬ ОТПРАВИТЕЛЯ (важно для выбора между "new_request" и "procurement"):
- Отправитель ХОЧЕТ КУПИТЬ наш товар или просит ИЗГОТОВИТЬ/ПОСТАВИТЬ ему продукцию ("нужно", "необходимо к закупу", "есть возможность поставки?", "можете поставить/изготовить", прислал ТЗ/спецификацию/карточку предприятия) — это КЛИЕНТ → "new_request". ДАЖЕ если отправитель из "отдела снабжения"/снабженец и пишет слова "закуп", "снабжение", "поставка". Должность отправителя НЕ делает письмо снабжением.
- "procurement" — ТОЛЬКО когда отправитель САМ ПРЕДЛАГАЕТ ПРОДАТЬ что-то НАМ ("предлагаем", "наш прайс", "готовы поставить вам", каталог поставщика). Признак снабжения: он продаёт НАМ, а не мы ему.`;
const improved = dbPrompt + DIRECTIONAL;
function docNames(att){ if(!Array.isArray(att))return[]; const ext=/\.(pdf|docx?|xlsx?|rtf|odt|ods|csv|txt|7z|zip|rar)$/i; const o=[]; for(const a of att){const n=(a?.filename||'').trim();const ct=(a?.contentType||'').toLowerCase();if(!n)continue;if(ct.startsWith('image/'))continue;if(ct==='message/rfc822')continue;if(!ext.test(n)&&!ct)continue;o.push(n);} return o;}
// выборка проверочных писем + ожидание
const samples = [
  ['os-2@surgutmebel.ru','new_request'],            // клиент-снабженец покупает у нас
  ['ko@zavod-vto.ru','procurement'],                // поставщик предлагает сотрудничество
  ['info@met-trans.ru','procurement'],              // рассылка поставщика
  ['email@promred.ru','procurement'],               // рассылка поставщика
  ['vertical_2022@mail.ru','new_request'],          // явная заявка на шкафы
  ['kashapova.a@nppamma.ru','new_request'],         // запрос стоимости/срока
];
let pass=0, tot=0;
for (const [from, exp] of samples){
  const e = (await sql.unsafe(`SELECT from_name,from_email,subject,body_text,attachments_meta FROM incoming_emails WHERE from_email='${from}' ORDER BY received_at DESC LIMIT 1`))[0];
  if(!e){ console.log(`(нет письма ${from})`); continue; }
  const docs = docNames(e.attachments_meta);
  const uc = `От кого: ${e.from_name||''} <${e.from_email||''}>\nТема: ${e.subject||''}${docs.length?`\nВложения (документы): ${docs.join('; ')}`:''}\n\nТело письма:\n${(e.body_text||'').slice(0,4000)||'(пусто)'}`;
  const c = await openai.chat.completions.create({model:'gpt-4o-mini',messages:[{role:'system',content:improved},{role:'user',content:uc}],response_format:{type:'json_object'},temperature:0});
  const r = JSON.parse(c.choices[0].message.content);
  tot++; const ok = r.route===exp; if(ok)pass++;
  console.log(`${ok?'OK  ':'FAIL'} ${from} → ${r.route} (ждали ${exp}) | ${(e.subject||'').slice(0,45)}`);
}
console.log(`\n${pass}/${tot}`);
await sql.end();
