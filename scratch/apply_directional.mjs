import postgres from 'postgres';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
const env = readFileSync('.env.local','utf8');
const get = k => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m ? m[1].trim().replace(/^["']|["']$/g,'') : ''; };
const sql = postgres(get('DATABASE_URL'), { ssl: 'require' });
const openai = new OpenAI({ apiKey: get('OPENAI_API_KEY') });

await sql.unsafe(readFileSync('migrations/20260630_email_router_directional.sql','utf8'));
const p = (await sql.unsafe(`SELECT system_prompt, position('НАПРАВЛЕНИЕ СДЕЛКИ' in system_prompt)>0 has_rule, length(system_prompt) len FROM ai_prompts WHERE key='email_secretary_classifier'`))[0];
console.log('Промпт обновлён:', p.has_rule, '| длина', p.len);

// проверка на боевом surgut с ОБНОВЛЁННЫМ прод-промптом
const e = (await sql.unsafe(`SELECT from_name,from_email,subject,body_text,attachments_meta FROM incoming_emails WHERE from_email='os-2@surgutmebel.ru' ORDER BY received_at DESC LIMIT 1`))[0];
function docNames(att){ if(!Array.isArray(att))return[]; const ext=/\.(pdf|docx?|xlsx?|rtf|odt|ods|csv|txt)$/i; const o=[]; for(const a of att){const n=(a?.filename||'').trim();const ct=(a?.contentType||'').toLowerCase();if(!n)continue;if(ct.startsWith('image/'))continue;if(ct==='message/rfc822')continue;if(!ext.test(n)&&!ct)continue;o.push(n);} return o;}
const docs=docNames(e.attachments_meta);
const uc=`От кого: ${e.from_name||''} <${e.from_email||''}>\nТема: ${e.subject}\nВложения (документы): ${docs.join('; ')}\n\nТело письма:\n${e.body_text}`;
const c=await openai.chat.completions.create({model:'gpt-4o-mini',messages:[{role:'system',content:p.system_prompt},{role:'user',content:uc}],response_format:{type:'json_object'},temperature:0});
const r=JSON.parse(c.choices[0].message.content);
console.log(`surgut с прод-промптом из БД → route=${r.route} conf=${r.confidence}\n  why: ${r.reasoning}`);
await sql.end();
