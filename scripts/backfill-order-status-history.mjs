// Разовый бэкфил истории статусов заказов из RetailCRM в order_history_log.
//
// Зачем: order_history_log ведётся только с 2026-01-16. Из-за этого заказы,
// созданные раньше и уже уехавшие из send-assembling в otgruzen/complete,
// не видны как «состоявшаяся сделка» — клиент ошибочно считается разовым
// в зарплате (salary_client_deal_counts).
//
// Что делает: для каждого заказа, созданного до порога и не имеющего ни одной
// строки field='status', тянет /api/v5/orders/history?filter[orderId]=N и
// вставляет ТОЛЬКО строки field='status' (upsert по retailcrm_history_id).
//
// Запуск:  node scripts/backfill-order-status-history.mjs [--limit N] [--dry]
// Резюмируемый: повторный запуск берёт только оставшиеся заказы.

import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const CUTOFF = process.env.BACKFILL_CUTOFF || '2026-01-16';
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || 4);
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 ? Number(args[i + 1]) : null;
})();

const BASE = (process.env.RETAILCRM_URL || '').replace(/\/+$/, '');
const KEY = process.env.RETAILCRM_API_KEY;
if (!BASE || !KEY) throw new Error('RETAILCRM_URL / RETAILCRM_API_KEY отсутствуют');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function fetchStatusHistory(orderId) {
    const rows = [];
    let page = 1;
    for (;;) {
        const p = new URLSearchParams({
            apiKey: KEY,
            limit: '100',
            page: String(page),
            'filter[orderId]': String(orderId),
        });
        let res;
        for (let attempt = 0; attempt < 5; attempt++) {
            res = await fetch(`${BASE}/api/v5/orders/history?${p}`);
            if (res.status !== 503 && res.status !== 429) break;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
        if (!res.ok) throw new Error(`history ${orderId}: HTTP ${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error(`history ${orderId}: success=false`);
        for (const it of j.history || []) {
            if (it.field !== 'status' || !it.order) continue;
            rows.push({
                retailcrm_history_id: it.id,
                retailcrm_order_id: it.order.id,
                field: it.field,
                old_value: typeof it.oldValue === 'object' ? JSON.stringify(it.oldValue) : String(it.oldValue ?? ''),
                new_value: typeof it.newValue === 'object' ? JSON.stringify(it.newValue) : String(it.newValue ?? ''),
                user_data: it.user || null,
                occurred_at: it.createdAt,
            });
        }
        const pg = j.pagination;
        if (pg && pg.currentPage < pg.totalPageCount) page++;
        else break;
    }
    return rows;
}

const targets = await sql`
    SELECT o.order_id
    FROM orders o
    WHERE o.created_at < ${CUTOFF}
      AND NOT EXISTS (
          SELECT 1 FROM order_history_log h
          WHERE h.retailcrm_order_id = o.order_id AND h.field = 'status'
      )
    ORDER BY o.created_at DESC
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
`;

console.log(`Заказов к бэкфилу: ${targets.length}${DRY ? ' (dry-run)' : ''}`);

let done = 0, inserted = 0, failed = 0;
const queue = targets.map((t) => Number(t.order_id));

async function worker() {
    for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        try {
            const rows = await fetchStatusHistory(id);
            if (rows.length && !DRY) {
                await sql`
                    INSERT INTO order_history_log ${sql(rows, 'retailcrm_history_id', 'retailcrm_order_id', 'field', 'old_value', 'new_value', 'user_data', 'occurred_at')}
                    ON CONFLICT (retailcrm_history_id) DO NOTHING
                `;
            }
            inserted += rows.length;
        } catch (e) {
            failed++;
            console.error(`#${id}:`, e.message);
        }
        done++;
        if (done % 200 === 0) console.log(`  ${done}/${targets.length}  строк: ${inserted}  ошибок: ${failed}`);
    }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`Готово. Заказов: ${done}, строк статуса: ${inserted}, ошибок: ${failed}`);
await sql.end();
