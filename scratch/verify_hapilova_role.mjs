import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const asOf = '2026-06-25';
const schemes = await sql`select code from salary_scheme where effective_from <= ${asOf}`;
const schemeCodes = new Set(schemes.map(s=>s.code));

const m = await sql`select id, raw_data->'groups' as groups from managers where id=321`;
const groups = (m[0].groups||[]).map(g=>({code:String(g.code), name:g.name}));
const candidates = [...new Set(groups.map(g=>g.code).filter(c=>schemeCodes.has(c)))];

const comp = await sql`select scheme_code from salary_manager_comp where manager_id=321 and effective_from <= ${asOf} order by effective_from desc limit 1`;
const choice = comp[0]?.scheme_code;

let resolved=null, needsChoice=false;
if (candidates.length===1) resolved=candidates[0];
else if (candidates.length>1){ if(choice && candidates.includes(choice)) resolved=choice; else needsChoice=true; }

console.log('candidates:', candidates);
console.log('saved choice:', choice);
console.log('=> resolved:', resolved, '| needsChoice:', needsChoice);
console.log(resolved==='kollczentr'
  ? '✅ Резолвится в КОЛЛЦЕНТР — из списка менеджеров ОП уходит.'
  : '⚠️ Не Коллцентр — проверить.');

await sql.end();
