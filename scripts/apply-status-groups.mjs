import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await c.connect();
await c.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260903_status_groups.sql'), 'utf8'));
console.log('Колонки group_code и ordering добавлены');

// Заполняем связь прямо из RetailCRM — синк на проде подхватит её дальше сам.
const url = process.env.RETAILCRM_URL, key = process.env.RETAILCRM_API_KEY;
const res = await fetch(`${url}/api/v5/reference/statuses?apiKey=${key}`);
const data = await res.json();
if (!data.success) throw new Error('RetailCRM вернул success=false');

let filled = 0;
for (const st of Object.values(data.statuses)) {
    if (!st?.code) continue;
    const r = await c.query(
        "UPDATE retailcrm_dictionaries SET group_code = $1, ordering = $2 WHERE entity_type='status' AND item_code = $3",
        [st.group ?? null, typeof st.ordering === 'number' ? st.ordering : null, String(st.code)]
    );
    filled += r.rowCount;
}
console.log('Статусов связано с группами:', filled);

const { rows } = await c.query(`SELECT g.item_name AS grp, count(*) AS n
  FROM retailcrm_dictionaries s
  LEFT JOIN retailcrm_dictionaries g ON g.entity_type='statusGroup' AND g.item_code = s.group_code
  WHERE s.entity_type='status' AND s.active GROUP BY g.item_name ORDER BY n DESC LIMIT 8`);
rows.forEach(r => console.log(`  ${r.grp ?? 'без группы'}: ${r.n}`));
await c.end();
