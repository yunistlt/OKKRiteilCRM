import postgres from 'postgres';
import { readFileSync } from 'fs';
import OpenAI from 'openai';
const env = readFileSync('.env.local','utf8');
const get = k => { const m = env.match(new RegExp('^'+k+'=(.*)$','m')); return m ? m[1].trim().replace(/^["']|["']$/g,'') : ''; };
const sql = postgres(get('DATABASE_URL'), { ssl: 'require' });
const openai = new OpenAI({ apiKey: get('OPENAI_API_KEY') });
const prompt = (await sql.unsafe(`SELECT system_prompt FROM ai_prompts WHERE key='email_secretary_classifier'`))[0].system_prompt;

function stripHtml(html){ if(!html) return ''; return html
  .replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<head[\s\S]*?<\/head>/gi,' ')
  .replace(/<!--[\s\S]*?-->/g,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi,'\n')
  .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/&quot;/gi,'"').replace(/&#39;|&rsquo;|&lsquo;/gi,"'").replace(/&[a-z#0-9]+;/gi,' ')
  .replace(/[^\S\n]+/g,' ').replace(/\n{3,}/g,'\n\n').trim(); }
function docNames(att){ if(!Array.isArray(att))return[]; const ext=/\.(pdf|docx?|xlsx?|rtf|odt|ods|csv|txt|7z|zip|rar)$/i; const o=[]; for(const a of att){const n=(a?.filename||'').trim();const ct=(a?.contentType||'').toLowerCase();if(!n)continue;if(ct.startsWith('image/'))continue;if(ct==='message/rfc822')continue;if(!ext.test(n)&&!ct)continue;o.push(n);} return o;}

const ids = {
  'ap-ps (заявка КП)':'d7d4c3e0-2e70-48e9-ba6f-517114068e99',
  'Borodina (стеллаж+счёт)':'5908f538-5c2e-48b2-8f9d-79fcc4313603',
  'kltechnology (заявка предоплата)':'9f9c14d6-b775-4c56-9d74-a6ee806aa378',
  'smartfleet (HTML-only)':'62180309-9004-4c96-880f-62014c91333d',
  'quantorm (спам-контроль)':'f2a921d7-41d8-435c-80e2-4f189fa22b88',
  'forest-profi (Re: заказ)':'9126f6a9-0496-439a-b554-ab311feb381e',
};
for (const [label, id] of Object.entries(ids)){
  const e = (await sql.unsafe(`SELECT from_name,from_email,subject,body_text,body_html,attachments_meta FROM incoming_emails WHERE id='${id}'`))[0];
  const raw = (e.body_text && e.body_text.trim()) ? e.body_text : stripHtml(e.body_html);
  const body = (raw||'').replace(/\s+\n/g,'\n').slice(0,4000);
  const docs = docNames(e.attachments_meta);
  const uc = `От кого: ${e.from_name||''} <${e.from_email||''}>\nТема: ${e.subject||''}${docs.length?`\nВложения (документы): ${docs.join('; ')}`:''}\n\nТело письма:\n${body||'(пусто)'}`;
  const c = await openai.chat.completions.create({model:'gpt-4o-mini',messages:[{role:'system',content:prompt},{role:'user',content:uc}],response_format:{type:'json_object'},temperature:0});
  const r = JSON.parse(c.choices[0].message.content);
  console.log(`[${label}] → ${r.route} (conf ${r.confidence}) | body_len=${body.length}\n   ${r.reasoning}\n`);
}
await sql.end();
