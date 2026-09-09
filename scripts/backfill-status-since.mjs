import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const c = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await c.connect();
await c.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260904_order_status_since.sql'), 'utf8'));
console.log('Колонка status_since добавлена');

// Берём последнюю смену статуса по каждому заказу. Если её нет — остаётся NULL,
// и потребитель честно считает от создания, помечая оценку приблизительной.
const { rowCount } = await c.query(`
    UPDATE orders o
    SET status_since = h.occurred_at
    FROM (
        SELECT DISTINCT ON (retailcrm_order_id) retailcrm_order_id, occurred_at
        FROM order_history_log
        WHERE field = 'status'
        ORDER BY retailcrm_order_id, occurred_at DESC
    ) h
    WHERE h.retailcrm_order_id = o.order_id
      AND (o.status_since IS DISTINCT FROM h.occurred_at)
`);
console.log('Заказов с проставленным моментом входа в статус:', rowCount);

const { rows } = await c.query('SELECT count(*) FILTER (WHERE status_since IS NOT NULL) AS filled, count(*) AS total FROM orders');
console.log(`Итого: ${rows[0].filled} из ${rows[0].total}`);
await c.end();
