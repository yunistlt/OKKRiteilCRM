// Разовый перелив статус-событий из raw_order_events в order_history_log.
// raw_order_events хранит сырые записи истории RetailCRM (raw_payload = элемент
// /orders/history) с 2024-01, а order_history_log — только с 2026-01-16.
// Зарплата (salary_client_deal_counts) читает order_history_log, поэтому
// переходы 2024–2025 в send-assembling ей не видны → постоянный клиент
// ошибочно считается новым.
//
// Запуск: node scripts/backfill-history-from-raw-events.mjs [--dry]

import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const DRY = process.argv.includes('--dry');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

const [{ count: candidates }] = await sql`
    SELECT count(*) AS count FROM raw_order_events e
    WHERE e.raw_payload->>'field' = 'status'
      AND (e.raw_payload->>'id') ~ '^\\d+$'
      AND NOT EXISTS (
          SELECT 1 FROM order_history_log h
          WHERE h.retailcrm_history_id = (e.raw_payload->>'id')::int
      )
`;
console.log(`Кандидатов к переливу: ${candidates}${DRY ? ' (dry-run)' : ''}`);

if (!DRY) {
    const res = await sql`
        INSERT INTO order_history_log (retailcrm_history_id, retailcrm_order_id, field, old_value, new_value, user_data, occurred_at)
        SELECT DISTINCT ON ((e.raw_payload->>'id')::int)
               (e.raw_payload->>'id')::int,
               e.retailcrm_order_id,
               'status',
               COALESCE(e.raw_payload->>'oldValue', ''),
               COALESCE(e.raw_payload->>'newValue', ''),
               e.raw_payload->'user',
               e.occurred_at
        FROM raw_order_events e
        WHERE e.raw_payload->>'field' = 'status'
          AND (e.raw_payload->>'id') ~ '^\\d+$'
        ORDER BY (e.raw_payload->>'id')::int, e.occurred_at
        ON CONFLICT (retailcrm_history_id) DO NOTHING
    `;
    console.log(`Вставлено строк: ${res.count}`);
}
await sql.end();
