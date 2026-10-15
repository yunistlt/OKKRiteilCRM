/**
 * Переиндексация журнала заданий — шаг второй после уборки.
 *
 * Удаление строк само по себе место на диске не возвращает: освободившееся
 * остаётся внутри файлов таблицы и её индексов. А раздулись именно индексы —
 * 1 693 МБ против 333 МБ данных, потому что автовакуум по system_jobs не
 * отрабатывал ни разу. Больше всех idx_system_jobs_ready: 1 316 МБ.
 *
 * REINDEX CONCURRENTLY строит индекс заново рядом и подменяет его — таблица
 * остаётся доступной на запись, конвейер не встаёт. Это важнее скорости:
 * REINDEX без CONCURRENTLY блокирует таблицу целиком, то есть останавливает
 * приём заданий.
 *
 * Запускать ПОСЛЕ scripts/cleanup-system-jobs.ts: по пустому журналу индексы
 * перестроятся за минуты и займут считанные мегабайты.
 *
 * Запуск:  npx tsx --env-file=.env.local scripts/reindex-system-jobs.ts
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1, idle_timeout: 0 });

const INDEXES = [
    'idx_system_jobs_ready',
    'idx_system_jobs_type_status',
    'system_jobs_idempotency_key_key',
    'system_jobs_pkey',
    'idx_system_jobs_lock_expires',
];

async function sizes() {
    const rows = await sql`
        SELECT indexrelname AS name, pg_relation_size(indexrelid) AS bytes
        FROM pg_stat_user_indexes WHERE relname = 'system_jobs'
    `;
    return new Map(rows.map((r: any) => [r.name, Number(r.bytes)]));
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} МБ`;

async function main() {
    const [{ bytes: dbBefore }] = await sql`SELECT pg_database_size(current_database()) AS bytes`;
    const before = await sizes();
    console.log(`База до переиндексации: ${mb(Number(dbBefore))}`);

    for (const index of INDEXES) {
        const was = before.get(index) ?? 0;
        process.stdout.write(`  ${index} (${mb(was)})… `);
        const t0 = Date.now();
        try {
            // Имя индекса подставляем идентификатором: параметров REINDEX не принимает.
            await sql.unsafe(`REINDEX INDEX CONCURRENTLY ${index}`);
            console.log(`готово за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
        } catch (e: any) {
            console.log(`не вышло: ${e.message}`);
        }
    }

    const after = await sizes();
    const [{ bytes: dbAfter }] = await sql`SELECT pg_database_size(current_database()) AS bytes`;

    console.log('\nСтало:');
    for (const index of INDEXES) {
        console.log(`  ${index}: ${mb(before.get(index) ?? 0)} → ${mb(after.get(index) ?? 0)}`);
    }
    console.log(`База: ${mb(Number(dbBefore))} → ${mb(Number(dbAfter))}`);

    await sql.end();
}

main().catch(async (e) => { console.error('ОШИБКА:', e.message); await sql.end(); process.exit(1); });
