import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
function extractLeadContact(body){
  const out={};
  if(!body) return out;
  const emailM = body.match(/e-?mail\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if(emailM) out.email=emailM[1].toLowerCase();
  const phoneM = body.match(/(?:тел(?:ефон)?|phone)\s*[:：]\s*(\+?\d[\d()\-\s]{5,}\d)/i);
  if(phoneM) out.phone=phoneM[1].replace(/[()\-\s]/g,'');
  const nameM = body.match(/ПОЛУЧАТЕЛЬ\s*[\r\n]+\s*([^\r\n]{1,80})/i) || body.match(/ПЛАТЕЛЬЩИК\s*[\r\n]+\s*([^\r\n]{1,80})/i);
  if(nameM) out.name=nameM[1].trim();
  return out;
}
const r = await sql.unsafe(`SELECT subject, body_text FROM incoming_emails WHERE from_email ILIKE '%webasyst%' ORDER BY received_at DESC`);
for(const x of r){
  console.log(`\n[${x.subject}] →`, JSON.stringify(extractLeadContact(x.body_text)));
}
// покажем тело формы «Заказать звонок»
const form = r.find(x=>/форм|звонок/i.test(x.subject));
if(form){ console.log('\n--- тело формы ---\n', (form.body_text||'').slice(0,400)); }
await sql.end();
