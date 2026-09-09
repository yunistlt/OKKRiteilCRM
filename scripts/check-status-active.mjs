// Только чтение: где лежит признак активности статуса заказа.
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
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 10 });

for (const t of ['statuses', 'status_settings', 'retailcrm_dictionaries']) {
    const cols = await sql`select column_name from information_schema.columns where table_name = ${t}`;
    console.log(`${t}: ${cols.map((c) => c.column_name).join(', ')}`);
}

console.log('\nвсего в statuses:', (await sql`select count(*) c from statuses`)[0].c);
console.log(
    'в справочнике RetailCRM (type=status):',
    JSON.stringify(
        await sql`select active, count(*) c from retailcrm_dictionaries where dictionary_code = 'status' group by active`,
    ),
);

console.log('\nсколько статусов из statuses активны по справочнику:');
console.table(
    await sql`select d.active, count(*) c
                from statuses s
                left join retailcrm_dictionaries d on d.item_code = s.code and d.dictionary_code = 'status'
               group by d.active`,
);

await sql.end();
