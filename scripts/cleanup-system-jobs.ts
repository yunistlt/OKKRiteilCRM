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
 * Мягко: партии по 500 строк, пауза втрое длиннее самой партии, и между
 * партиями отдельная проверка отклика базы. Разовый DELETE на полмиллиона
 * строк — та же нагрузка, что уронила базу 15.10.2026, и владелец прямо
 * просил чистить мелкими партиями с паузами.
 *
 * Идём курсором по номеру записи, а не отбором по статусу: отбор заставляет
 * базу перебирать всю таблицу целиком, и первый же прогон 15.10.2026 упёрся в
 * двухминутный потолок запроса. По номеру работает первичный ключ — партия
 * выбирается за 66 мс вместо двух минут.
 *
 * Прогон можно прервать в любой момент: удалённое удалено, остальное доберёт
 * следующий запуск.
 *
 * Запуск:  npx tsx --env-file=.env.local scripts/cleanup-system-jobs.ts [--dry] [--batch 500]
 */
import postgres from 'postgres';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BATCH = (() => {
    const i = args.indexOf('--batch');
    return i >= 0 ? Number(args[i + 1]) : 500;
})();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 2 });

/** Сколько база отвечает на простейший запрос: занята ли она чем-то тяжёлым. */
async function pingMs() {
    const t0 = Date.now();
    await sql`SELECT 1`;
    return Date.now() - t0;
}

async function sizeMb() {
    const [row] = await sql`SELECT pg_database_size(current_database()) AS bytes`;
    return Math.round(Number(row.bytes) / 1024 / 1024);
}

async function main() {
    // Потолок по умолчанию — две минуты, и тяжёлый счётчик в него не влезает.
    await sql`SET statement_timeout = '5min'`;

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
    let slowStreak = 0;
    const started = Date.now();
    let lastReport = Date.now();

    // Курсор по номеру записи: следующая партия всегда правее уже пройденного.
    let cursor = 0;

    for (;;) {
        const t0 = Date.now();

        const found = await sql`
            SELECT id FROM system_jobs
            WHERE id > ${cursor}
              AND status = 'completed'
              AND created_at < now() - interval '30 days'
            ORDER BY id
            LIMIT ${BATCH}
        `;
        if (!found.length) break;

        const ids = found.map((r: any) => r.id);
        cursor = Number(ids[ids.length - 1]);

        const deleted = await sql`DELETE FROM system_jobs WHERE id = ANY(${sql.array(ids)}) RETURNING id`;
        const elapsed = Date.now() - t0;

        if (!deleted.length) continue;
        removed += deleted.length;

        if (elapsed > 10000) {
            console.log(`СТОП: партия удалялась ${(elapsed / 1000).toFixed(1)} с — база напряглась. Удалено ${removed.toLocaleString('ru-RU')}, остальное доберёт повторный запуск.`);
            break;
        }

        // Пауза втрое длиннее партии, но не меньше секунды: база должна
        // успевать обслуживать людей и кроны, а не только нас.
        let pause = Math.min(10000, Math.max(1000, elapsed * 3));

        // Отклик базы на пустяковом запросе. Отвечает медленно — значит ей
        // тяжело, ждём дольше; три раза подряд — прекращаем совсем.
        const ping = await pingMs();
        if (ping > 2000) {
            slowStreak++;
            pause = Math.min(30000, pause * 4);
            console.log(`  база отвечает за ${(ping / 1000).toFixed(1)} с — ждём ${(pause / 1000).toFixed(0)} с`);
            if (slowStreak >= 3) {
                console.log(`СТОП: база тормозит третий раз подряд. Удалено ${removed.toLocaleString('ru-RU')}, остальное доберёт повторный запуск.`);
                break;
            }
        } else {
            slowStreak = 0;
        }

        if (Date.now() - lastReport >= 30000) {
            const left = Number(count) - removed;
            console.log(`  удалено ${removed.toLocaleString('ru-RU')} из ${Number(count).toLocaleString('ru-RU')}, осталось ${left.toLocaleString('ru-RU')}, партия за ${(elapsed / 1000).toFixed(1)} с`);
            lastReport = Date.now();
        }

        await new Promise((r) => setTimeout(r, pause));
    }

    console.log(`Готово за ${((Date.now() - started) / 60000).toFixed(1)} мин. Удалено ${removed.toLocaleString('ru-RU')}. База ${await sizeMb()} МБ.`);
    console.log('Место вернётся на диск после переиндексации — она идёт отдельным шагом.');
    await sql.end();
}

main().catch(async (e) => { console.error('ОШИБКА:', e.message); await sql.end(); process.exit(1); });
