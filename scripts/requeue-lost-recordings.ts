/**
 * Разовый возврат в очередь разговоров, ошибочно помеченных «не дозвонились».
 *
 * Вебхук об окончании звонка приходит раньше, чем Телфин выкладывает запись. В этот
 * момент звонок получал приговор `no_answer` / `no_recording`, а крон расшифровки берёт
 * только `pending` и `ready_for_transcription` — и состоявшийся разговор выпадал навсегда.
 * Причина устранена в lib/telphin-call-outcome.ts (приговор отменяется, когда появилась
 * запись); этот скрипт разбирает то, что уже накопилось.
 *
 * Берём только те, где есть и отвеченная нога, и запись: это заведомо разговоры.
 *
 *   npx tsx scripts/requeue-lost-recordings.ts           # показать, ничего не менять
 *   npx tsx scripts/requeue-lost-recordings.ts --apply   # вернуть в очередь
 */
import postgres from 'postgres';
import dotenv from 'dotenv';
import { READY_STATUS } from '../lib/telphin-call-outcome';

dotenv.config({ path: '.env.local' });

const apply = process.argv.includes('--apply');
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
    const rows = await sql<{ telphin_call_id: string; started_at: Date; duration_sec: number; transcription_status: string }[]>`
        select telphin_call_id, started_at, duration_sec, transcription_status
        from raw_telphin_calls
        where transcript is null
          and recording_url is not null
          and transcription_status in ('no_answer', 'no_recording')
          and exists (
            select 1 from jsonb_array_elements(raw_payload->'cdr') leg
            where lower(leg->>'result') = 'answered'
          )
        order by started_at
    `;

    if (rows.length === 0) {
        console.log('Потерянных разговоров нет — очередь чистая.');
        return;
    }

    const first = rows[0].started_at.toISOString().slice(0, 10);
    const last = rows[rows.length - 1].started_at.toISOString().slice(0, 10);
    const minutes = Math.round(rows.reduce((a, r) => a + (r.duration_sec || 0), 0) / 60);
    console.log(`Найдено разговоров с записью и приговором «нечего расшифровывать»: ${rows.length}`);
    console.log(`  период: ${first} — ${last}, суммарно ${minutes} минут разговоров`);

    if (!apply) {
        console.log('\nПримерка. Чтобы вернуть в очередь: --apply');
        return;
    }

    const ids = rows.map((r) => r.telphin_call_id);
    const updated = await sql`
        update raw_telphin_calls
        set transcription_status = ${READY_STATUS}
        where telphin_call_id in ${sql(ids)}
          and transcript is null
          and transcription_status in ('no_answer', 'no_recording')
        returning telphin_call_id
    `;
    console.log(`Возвращено в очередь: ${updated.length}. Крон расшифровки разберёт их в ближайшие проходы.`);
}

main()
    .catch((e) => { console.error('Ошибка:', e.message); process.exitCode = 1; })
    .finally(() => sql.end());
