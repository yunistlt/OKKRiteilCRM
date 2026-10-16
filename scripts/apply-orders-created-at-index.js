// Разовое применение migrations/20261016_orders_created_at_index.sql.
// CREATE INDEX CONCURRENTLY нельзя внутри транзакции, поэтому команды идут по одной.
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const statements = [
    'SET statement_timeout = 0',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at_alive ON public.orders USING btree (created_at DESC) WHERE crm_deleted_at IS NULL',
    'ANALYZE public.orders',
];

(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await client.connect();
    try {
        for (const sql of statements) {
            console.log('>>', sql.slice(0, 80));
            const t0 = Date.now();
            await client.query(sql);
            console.log('   готово за', Date.now() - t0, 'мс');
        }
        const plan = await client.query(
            'EXPLAIN ANALYZE SELECT order_id, number, status, created_at FROM orders WHERE crm_deleted_at IS NULL ORDER BY created_at DESC LIMIT 50'
        );
        console.log('--- план после индекса');
        console.log(plan.rows.map((r) => r['QUERY PLAN']).join('\n'));
    } catch (e) {
        console.error('ОШИБКА:', e.message);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
})();
