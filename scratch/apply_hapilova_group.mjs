import postgres from 'postgres';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const get = k => (env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1]?.replace(/^["']|["']$/g,'').trim();
const sql = postgres(get('DATABASE_URL')||get('POSTGRES_URL'), { ssl:'require' });

const dict = await sql`select item_code, item_name from retailcrm_dictionaries where entity_type='userGroup' and item_code='kollczentr' limit 1`;
const name = dict[0]?.item_name ?? 'Коллцентр';

const cur = await sql`select id, raw_data->'groups' as groups from managers where id=321`;
const groups = Array.isArray(cur[0].groups) ? cur[0].groups : [];
console.log('BEFORE groups codes:', groups.map(g=>g.code));

if (groups.some(g=>g.code==='kollczentr')) {
  console.log('kollczentr уже есть — пропускаю');
} else {
  const updated = [...groups, { code:'kollczentr', name }];
  await sql`update managers set raw_data = jsonb_set(raw_data, '{groups}', ${sql.json(updated)}::jsonb) where id=321`;
  console.log('AFTER groups codes:', updated.map(g=>g.code));
}

await sql.end();
