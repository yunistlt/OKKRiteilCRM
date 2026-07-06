import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const fmt=v=>Math.round(Number(v)||0).toLocaleString('ru-RU');

console.log('=== рабочие статусы (is_working=true) ===');
const ws = await sql.unsafe(`SELECT code, name, group_name FROM statuses WHERE is_working=true ORDER BY group_name, code`);
console.table(ws);

console.log('\n=== текущие заказы в рабочих статусах: count & Σ totalsumm ===');
const cur = await sql.unsafe(`
  SELECT o.status, s.name, count(*) cnt, round(sum(o.totalsumm)) sm
  FROM orders o JOIN statuses s ON s.code=o.status
  WHERE s.is_working=true
  GROUP BY o.status, s.name ORDER BY sm DESC NULLS LAST`);
console.table(cur.map(r=>({status:r.status, name:r.name, cnt:Number(r.cnt), sum:fmt(r.sm)})));

const tot = await sql.unsafe(`SELECT count(*) cnt, round(sum(o.totalsumm)) sm FROM orders o JOIN statuses s ON s.code=o.status WHERE s.is_working=true`);
console.log('\nИТОГО в работе:', tot[0].cnt, 'заказов,', fmt(tot[0].sm), '₽ (с НДС как в CRM)');
await sql.end();
