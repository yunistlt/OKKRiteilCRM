/**
 * Вернуть в очередь звонки, помеченные «запись устарела».
 *
 * На 28.09.2026 в статусе `expired` лежало 2 580 звонков за сентябрь 2025 — февраль 2026.
 * Выборочная проверка показала, что ссылки Телфина живы и файлы скачиваются: статус не
 * соответствует действительности. В действующем коде `expired` не ставится нигде — это
 * была разовая ручная операция, поэтому повторно звонки так не пометит.
 *
 * Скрипт не верит ни статусу, ни себе: для каждого звонка запрашивает запись (HEAD) и
 * возвращает в очередь только те, что реально отдаются. Недоступные оставляет как есть.
 *
 * Расшифровка идёт через свой STT-сервер, так что возврат хвоста ничего не стоит.
 * Внешний воркер забирает статусы pending / ready_for_transcription / failed
 * (claim_calls_for_external_stt), поэтому возвращаем в `pending`.
 *
 * Запуск:
 *   npx tsx scripts/requeue-expired-recordings.ts             # только проверить и показать
 *   npx tsx scripts/requeue-expired-recordings.ts --apply     # вернуть в очередь
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

loadEnv({ path: '.env.local' });
loadEnv();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('Нет DATABASE_URL (или POSTGRES_URL) в окружении');
    process.exit(1);
}
const sql = postgres(connectionString, { ssl: 'require' });

const APPLY = process.argv.includes('--apply');
const PARALLEL = 10;   // бережно к storage.telphin.ru
const CHUNK = 500;
const int = (n: number) => n.toLocaleString('ru-RU');

type Row = { telphin_call_id: string; recording_url: string };

/** Отдаётся ли запись. Любая ошибка сети — считаем недоступной и не трогаем звонок. */
async function isRecordingAlive(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
        if (!response.ok) return false;
        const size = Number(response.headers.get('content-length') || 0);
        return size > 0;
    } catch {
        return false;
    }
}

async function main() {
    const rows = await sql<Row[]>`
        SELECT telphin_call_id, recording_url
        FROM raw_telphin_calls
        WHERE transcription_status = 'expired'
          AND recording_url IS NOT NULL
          AND transcript IS NULL
        ORDER BY started_at DESC
    `;

    console.log(`Помечено «запись устарела»: ${int(rows.length)}`);
    console.log('Проверяю, отдаются ли записи…');

    const alive: string[] = [];
    let dead = 0;
    let checked = 0;

    for (let i = 0; i < rows.length; i += PARALLEL) {
        const batch = rows.slice(i, i + PARALLEL);
        const results = await Promise.all(batch.map((row) => isRecordingAlive(row.recording_url)));

        results.forEach((ok, index) => {
            if (ok) alive.push(batch[index].telphin_call_id);
            else dead++;
        });

        checked += batch.length;
        process.stdout.write(`\rпроверено ${int(checked)} из ${int(rows.length)} — живых ${int(alive.length)}, недоступных ${int(dead)}`);
    }

    console.log('\n');
    console.log(`Записи на месте: ${int(alive.length)} — можно расшифровать`);
    console.log(`Действительно недоступны: ${int(dead)} — оставляю как есть`);

    if (!APPLY) {
        console.log('\nЭто предварительная проверка. Для возврата в очередь: --apply');
        await sql.end();
        return;
    }

    for (let i = 0; i < alive.length; i += CHUNK) {
        const chunk = alive.slice(i, i + CHUNK);
        await sql`
            UPDATE raw_telphin_calls
            SET transcription_status = 'pending', stt_job_id = NULL, stt_submitted_at = NULL
            WHERE telphin_call_id = ANY(${chunk})
        `;
        process.stdout.write(`\rвозвращено в очередь ${int(Math.min(i + CHUNK, alive.length))} из ${int(alive.length)}`);
    }

    console.log('\nГотово. Звонки разберёт ночной проход STT — по своей очереди, не разом.');
    await sql.end();
}

main().catch(async (error) => {
    console.error('Провал:', error.message);
    await sql.end().catch(() => {});
    process.exit(1);
});
