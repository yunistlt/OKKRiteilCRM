import postgres from 'postgres';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trimStart().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
const sql=postgres(env.DATABASE_URL,{ssl:'require',max:2});
const openai=new OpenAI({apiKey:env.OPENAI_API_KEY});
const emb=async t=>(await openai.embeddings.create({model:'text-embedding-3-small',input:t})).data[0].embedding;
const search=async(q,onlyBot)=>{const e='['+(await emb(q)).join(',')+']';
  return sql`SELECT domain,bot_can_answer,situation,response,round(similarity::numeric,3) sim FROM match_dialog_knowledge(${e}::vector,0.3,3,${onlyBot},null)`;};
try{
  const tot=await sql`SELECT count(*) c, count(*) FILTER(WHERE bot_can_answer) bot FROM dialog_knowledge`;
  console.log('В базе:',tot[0].c,'юнитов, из них боту',tot[0].bot,'\n');
  for(const q of ['какой срок изготовления шкафов','а доставку до Москвы посчитаете']){
    console.log('❓',q);
    for(const r of await search(q,true)){console.log(`  🟢[${r.domain} ${r.sim}] ${r.situation.slice(0,60)} → ${r.response.slice(0,70)}`);}
    console.log('');
  }
  console.log('— ТЕСТ ГРАНИЦЫ: запрос про возврат денег, бот (only_bot_answerable=true) —');
  const leak=await search('верните мне деньги за заказ',true);
  console.log('  боту вернулось:',leak.length,'юнитов', leak.every(r=>r.bot_can_answer)?'(все bot_can_answer=true ✓)':'⚠️УТЕЧКА');
  leak.forEach(r=>console.log(`    [${r.domain}] ${r.situation.slice(0,55)}`));
  console.log('  — тот же запрос БЕЗ ограничения (only_bot_answerable=false) —');
  const full=await search('верните мне деньги за заказ',false);
  full.forEach(r=>console.log(`    [${r.domain} bot=${r.bot_can_answer}] ${r.situation.slice(0,55)}`));
}catch(e){console.error(e.message)}finally{await sql.end()}
