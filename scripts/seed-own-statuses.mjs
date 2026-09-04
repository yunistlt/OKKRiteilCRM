import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

/**
 * РАЗОВЫЙ перенос статусов RetailCRM в наши таблицы — стартовая заготовка, не связь.
 * После него наши статусы живут своей жизнью: синк их не трогает и не перезаписывает.
 * В external_code кладём код исходного статуса — метка для будущего сопоставления.
 */
const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await c.connect();

const { rows: existing } = await c.query('SELECT count(*) FROM crm_statuses');
if (Number(existing[0].count) > 0) {
    console.log('Свои статусы уже заведены — перенос пропущен, чтобы не задвоить.');
    await c.end();
    process.exit(0);
}

const { rows: groups } = await c.query(
    "SELECT item_code, item_name FROM retailcrm_dictionaries WHERE entity_type='statusGroup' AND active ORDER BY item_name"
);
const groupIds = new Map();
let order = 10;
for (const g of groups) {
    const { rows } = await c.query(
        `INSERT INTO crm_status_groups (code, name, ordering, external_code)
         VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [g.item_code, g.item_name, order, g.item_code]
    );
    groupIds.set(g.item_code, rows[0].id);
    order += 10;
}

const { rows: statuses } = await c.query(`
    SELECT d.item_code, d.item_name, d.group_code, d.ordering, s.color, s.norm_days,
           COALESCE(ss.is_working, false) AS is_working
    FROM retailcrm_dictionaries d
    LEFT JOIN statuses s ON s.code = d.item_code
    LEFT JOIN status_settings ss ON ss.code = d.item_code
    WHERE d.entity_type = 'status' AND d.active AND COALESCE(s.is_active, true)
    ORDER BY d.ordering NULLS LAST, d.item_name`);

let moved = 0;
for (const s of statuses) {
    await c.query(
        `INSERT INTO crm_statuses (code, name, group_id, color, ordering, norm_days, is_working, external_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (code) DO NOTHING`,
        [s.item_code, s.item_name, groupIds.get(s.group_code) ?? null, s.color,
         s.ordering ?? 100, s.norm_days, s.is_working, s.item_code]
    );
    moved += 1;
}

console.log(`Перенесено групп: ${groups.length}, статусов: ${moved}`);
console.log('Дальше они живут отдельно — синк RetailCRM их не изменяет.');
await c.end();
