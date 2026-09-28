/**
 * Разобрать накопленную очередь расшифровок: заменить вечное «ждёт расшифровки» на причину.
 *
 * На 28.09.2026 в `pending` висело 6 978 звонков, из них 6 464 без записи — их нельзя
 * расшифровать никогда. Скрипт проходит по ним и ставит честный статус: «не дозвонились»
 * или «без записи» (см. lib/telphin-call-outcome.ts). Звонки с записью не трогает — они
 * законно ждут своей очереди.
 *
 * Запуск:
 *   npx tsx scripts/backfill-call-outcome.ts            # только показать, что изменится
 *   npx tsx scripts/backfill-call-outcome.ts --apply    # записать
 */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

// Доступы лежат в .env.local — dotenv сам его не читает.
loadEnv({ path: '.env.local' });
loadEnv();
import { resolveTranscriptionStatus, NO_ANSWER_STATUS, NO_RECORDING_STATUS } from '../lib/telphin-call-outcome';

// Через postgres-js, а не через service-role клиент: ключа service-role в .env.local нет,
// а DATABASE_URL есть — скрипт должен запускаться с машины разработчика, как остальные разовые операции.
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('Нет DATABASE_URL (или POSTGRES_URL) в окружении');
    process.exit(1);
}
const sql = postgres(connectionString, { ssl: 'require' });

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

async function main() {
    const rows = await sql<
        { telphin_call_id: string | null; transcription_status: string | null; transcript: string | null; recording_url: string | null; raw_payload: unknown }[]
    >`
        SELECT telphin_call_id, transcription_status, transcript, recording_url, raw_payload
        FROM raw_telphin_calls
        WHERE transcription_status IN ('pending', 'ready_for_transcription')
          AND recording_url IS NULL
        ORDER BY started_at ASC
    `;

    const planned: Record<string, string[]> = { [NO_ANSWER_STATUS]: [], [NO_RECORDING_STATUS]: [] };

    for (const row of rows) {
        const status = resolveTranscriptionStatus({
            rawPayload: row.raw_payload,
            recordingUrl: row.recording_url,
            currentStatus: row.transcription_status,
            hasTranscript: Boolean(row.transcript),
        });
        if (status && row.telphin_call_id) planned[status].push(row.telphin_call_id);
    }

    const int = (n: number) => n.toLocaleString('ru-RU');
    console.log(`Просмотрено звонков без записи: ${int(rows.length)}`);
    console.log(`  Не дозвонились (соединения не было): ${int(planned[NO_ANSWER_STATUS].length)}`);
    console.log(`  Без записи (соединение было, записи нет): ${int(planned[NO_RECORDING_STATUS].length)}`);

    const untouched = rows.length - planned[NO_ANSWER_STATUS].length - planned[NO_RECORDING_STATUS].length;
    if (untouched > 0) console.log(`  Оставлено как есть: ${int(untouched)}`);

    if (!APPLY) {
        console.log('\nЭто предварительный просмотр. Для записи: --apply');
        await sql.end();
        return;
    }

    for (const [status, ids] of Object.entries(planned)) {
        for (let i = 0; i < ids.length; i += PAGE) {
            const chunk = ids.slice(i, i + PAGE);
            await sql`UPDATE raw_telphin_calls SET transcription_status = ${status} WHERE telphin_call_id = ANY(${chunk})`;
            process.stdout.write(`\r${status}: записано ${int(Math.min(i + PAGE, ids.length))} из ${int(ids.length)}`);
        }
        if (ids.length) console.log('');
    }

    console.log('\nГотово.');
    await sql.end();
}

main().catch(async (error) => {
    console.error('Провал:', error.message);
    await sql.end().catch(() => {});
    process.exit(1);
});
