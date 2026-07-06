import postgres from 'postgres';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
const env = readFileSync('.env.local','utf8');
const get = k => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m ? m[1].trim().replace(/^["']|["']$/g,'') : ''; };
const sql = postgres(get('DATABASE_URL'), { ssl: 'require' });
const openai = new OpenAI({ apiKey: get('OPENAI_API_KEY') });

// прод-промпт из БД (тот, что реально работает)
const p = await sql.unsafe(`SELECT system_prompt, is_active FROM ai_prompts WHERE key='email_secretary_classifier'`);
const systemPrompt = p[0]?.system_prompt;
console.log('Промпт из БД активен:', p[0]?.is_active, '| длина', systemPrompt?.length);

function docNames(att){ if(!Array.isArray(att))return[]; const ext=/\.(pdf|docx?|xlsx?|rtf|odt|ods|csv|txt|7z|zip|rar)$/i; const o=[]; for(const a of att){const n=(a?.filename||'').trim(); const ct=(a?.contentType||'').toLowerCase(); if(!n)continue; if(ct.startsWith('image/'))continue; if(ct==='message/rfc822')continue; if(!ext.test(n)&&!ct)continue; o.push(n);} return o; }

async function run(email, label, withFix){
  const docs = withFix ? docNames(email.attachments_meta) : [];
  const attLine = docs.length ? `\nВложения (документы): ${docs.join('; ')}` : '';
  const body = (email.body_text||'').slice(0,4000);
  const uc = `От кого: ${email.from_name||''} <${email.from_email||''}>\nТема: ${email.subject||'(без темы)'}${attLine}\n\nТело письма:\n${body || (withFix ? '(пусто — суть письма может быть во вложении и/или в теме)' : '(пусто)')}`;
  const c = await openai.chat.completions.create({ model:'gpt-4o-mini', messages:[{role:'system',content:systemPrompt},{role:'user',content:uc}], response_format:{type:'json_object'}, temperature:0 });
  const r = JSON.parse(c.choices[0].message.content);
  console.log(`\n[${label}] route=${r.route} conf=${r.confidence}\n  why: ${r.reasoning}`);
}

const k = (await sql.unsafe(`SELECT from_email,from_name,subject,body_text,attachments_meta FROM incoming_emails WHERE from_email='exp-n@yandex.ru' AND received_at>=now()-interval '7 days' LIMIT 1`))[0];
await run(k, 'Кулынченко — БЕЗ фикса (как сейчас в проде)', false);
await run(k, 'Кулынченко — С фиксом (имена вложений + хвост)', true);

await sql.end();
