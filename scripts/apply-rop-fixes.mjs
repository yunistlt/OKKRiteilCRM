// Применение миграций вечернего отчёта РОПа + проверка цифр и времени.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const fs = require('fs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.DATABASE_URL = fs
    .readFileSync(path.join(root, '.env.local'), 'utf8')
    .match(/^DATABASE_URL=(.*)$/m)[1]
    .replace(/^"|"$/g, '');

const postgres = (await import('postgres')).default;
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20 });
const day = process.argv[2] || new Date().toISOString().slice(0, 10);

const before = (await sql.unsafe(`select * from sales_rop_day_facts('${day}')`))[0];
console.log('цифры до :', JSON.stringify(before));

for (const f of ['20260902_day_facts_scope.sql', '20260902_month_by_manager.sql']) {
    await sql.unsafe(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    console.log('применено:', f);
}

const t = Date.now();
const after = (await sql.unsafe(`select * from sales_rop_day_facts('${day}')`))[0];
console.log('цифры после:', JSON.stringify(after), ((Date.now() - t) / 1000).toFixed(2) + 's');
const diff = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]));
console.log(diff.length ? 'РАСХОЖДЕНИЕ: ' + diff.join(', ') : 'цифры совпадают');

console.log('— выручка месяца по менеджерам —');
console.table(await sql.unsafe(`select * from sales_rop_month_by_manager('${day}')`));
console.log('— планы на месяц (что покажет бот) —');
console.table(
    await sql.unsafe(`select manager_id, target from salary_plan
                      where year = ${Number(day.slice(0, 4))} and month = ${Number(day.slice(5, 7))}
                        and metric = 'revenue_no_vat' order by manager_id nulls first`),
);

await sql.end();
