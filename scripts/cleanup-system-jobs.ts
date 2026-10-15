/**
 * Уборка журнала заданий конвейера.
 *
 * Зачем: в system_jobs 648 109 строк, из них 646 003 — задания, которые давно
 * выполнены. Данные 333 МБ, индексы 1 693 МБ: автовакуум по таблице не
 * отрабатывал ни разу, индексы раздулись впятеро. Из-за этого на MICRO-базе
 * диск занят на 82%, докачке истории не хватает места, а кроны каждую минуту
 * сканируют раздутые индексы (решение владельца 15.10.2026 — чистим).
 *
 * Что удаляется: только status='completed' старше 30 дней — 552 335 записей о
 * заданиях «потянуть дельту», «пересчитать баллы», «сматчить звонок» за
 * 03.05–15.09.2026. Это журнал конвейера, не данные заказов.
 *
 * Что НЕ трогаем:
 *  - всё за последние 30 дней (его читают отчёт о задержках и пульс конвейера);
 *  - dead_letter — следы ошибок, по ним разбираются;
 *  - queued и processing — живая очередь.
 *
 * Повторную обработку это не открывает: enqueueSystemJob кладёт задание
 * upsert'ом по idempotency_key, то есть и сейчас переписал бы выполненную
 * строку заново. Разница только в том, что строка создастся новой.
 *
 * Партиями и с паузой: разовый DELETE на полмиллиона строк — та же нагрузка,
 * что уронила базу 15.10.2026.
 *
 * Запуск:  npx tsx --env-file=.env.local scripts/cleanup-system-jobs.ts [--dry] [--batch 5000]
 */
import postgres from 'postgres';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BATCH = (() => {
    const i = args.indexOf('--batch');
    return i >= 0 ? Number(args[i + 1]) : 5000;
})();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 2 });

async function sizeMb() {
    const [row] = await sql`SELECT pg_database_size(current_database()) AS bytes`;
    return Math.round(Number(row.bytes) / 1024 / 1024);
}

async function main() {
    const [{ count }] = await sql`
        SELECT count(*)::bigint AS count FROM system_jobs
        WHERE status = 'completed' AND created_at < now() - interval '30 days'
    `;
    console.log(`К удалению: ${Number(count).toLocaleString('ru-RU')} записей. База ${await sizeMb()} МБ.`);

    if (DRY) {
        await sql.end();
        return;
    }

    let removed = 0;
    const started = Date.now();

    for (;;) {
        const t0 = Date.now();
        const deleted = await sql`
            DELETE FROM system_jobs
            WHERE id IN (
                SELECT id FROM system_jobs
                WHERE status = 'completed' AND created_at < now() - interval '30 days'
                LIMIT ${BATCH}
            )
            RETURNING id
        `;
        const elapsed = Date.now() - t0;

        if (!deleted.length) break;
        removed += deleted.length;

        if (elapsed > 15000) {
            console.log(`СТОП: партия удалялась ${(elapsed / 1000).toFixed(1)} с — база напряглась. Удалено ${removed}, остальное можно добрать повторным запуском.`);
            break;
        }

        if (removed % 50000 < BATCH) {
            console.log(`  удалено ${removed.toLocaleString('ru-RU')}, последняя партия за ${(elapsed / 1000).toFixed(1)} с`);
        }

        // Пауза вдвое больше времени партии: база успевает дышать.
        await new Promise((r) => setTimeout(r, Math.min(2000, elapsed * 2)));
    }

    console.log(`Готово за ${((Date.now() - started) / 60000).toFixed(1)} мин. Удалено ${removed.toLocaleString('ru-RU')}. База ${await sizeMb()} МБ.`);
    console.log('Место вернётся на диск после переиндексации — она идёт отдельным шагом.');
    await sql.end();
}

main().catch(async (e) => { console.error('ОШИБКА:', e.message); await sql.end(); process.exit(1); });
