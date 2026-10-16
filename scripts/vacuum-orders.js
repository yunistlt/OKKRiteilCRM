// Приведение таблицы orders в состояние, в котором база может её обслуживать сама.
//
// Корень аварии 16.10.2026: сбор статистики по JSON-колонкам orders (одно только
// raw_payload — 302 МБ сжатого JSON) не доходит до конца, ANALYZE висит десятками
// минут. Поэтому автоочистка по таблице не отрабатывала НИ РАЗУ за всю жизнь базы:
// last_vacuum, last_autovacuum, last_analyze были пусты, планировщик считал, что в
// таблице 10 строк вместо 38 тысяч, и COUNT(*) читал её целиком с диска по 50 секунд —
// дольше таймаута Supabase. Отсюда пустой список заказов и упавший утренний крон.
//
// Планировщику статистика по телу JSON не нужна: распределение значений внутри jsonb
// он всё равно не строит, а поиск по полям идёт через GIN-индексы и функциональные
// индексы (у тех своя статистика, она собирается отдельно и дёшево). Отключаем её
// сбор — и обслуживание таблицы становится посильным, в том числе автоматическое.
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await client.connect();
    try {
        await client.query('SET statement_timeout = 0');

        const { rows: jsonCols } = await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND data_type IN ('jsonb', 'json')"
        );
        console.log('>> JSON-колонки без сбора статистики:', jsonCols.map((c) => c.column_name).join(', '));
        for (const { column_name } of jsonCols) {
            await client.query(`ALTER TABLE public.orders ALTER COLUMN "${column_name}" SET STATISTICS 0`);
        }

        for (const [title, sql] of [
            ['Уборка и карта видимости', 'VACUUM public.orders'],
            ['Статистика по рабочим колонкам', 'ANALYZE public.orders'],
        ]) {
            console.log('>>', title);
            const t0 = Date.now();
            await client.query(sql);
            console.log('   готово за', Math.round((Date.now() - t0) / 1000), 'с');
        }

        const stat = await client.query(
            "SELECT n_live_tup, last_vacuum, last_analyze FROM pg_stat_user_tables WHERE relname = 'orders'"
        );
        console.log('--- состояние таблицы:', JSON.stringify(stat.rows[0]));

        const plan = await client.query('EXPLAIN ANALYZE SELECT count(*) FROM orders WHERE crm_deleted_at IS NULL');
        console.log('--- пересчёт количества заказов');
        console.log(plan.rows.map((r) => r['QUERY PLAN']).join('\n'));
    } catch (e) {
        console.error('ОШИБКА:', e.message);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
})();
