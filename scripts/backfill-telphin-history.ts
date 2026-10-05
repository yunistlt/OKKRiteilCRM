/**
 * Дотяжка истории звонков из Телфина.
 *
 * Решение владельца 05.10.2026: «дотягивай историю Телфина, все звонки должны
 * быть у нас». Повод — Евгения искала звонки клиента за август 2024, а у нас
 * база начинается с 02.06.2025: раньше звонков просто нет.
 *
 * Что берём: саму историю и ссылку на запись разговора. Расшифровку тут НЕ
 * заказываем — это платно и на десятках тысяч старых звонков стоило бы дорого;
 * текст подтянем отдельно и осознанно. Поэтому очередь транскрибации скрипт не
 * трогает, в отличие от обычной синхронизации.
 *
 * Идём окнами по дню от конца к началу, чтобы свежее появлялось раньше, и
 * помним, где остановились (`sync_state.telphin_history_backfill_day`): прогон
 * можно прервать и продолжить следующей ночью с того же места.
 *
 * Запуск:
 *   npx tsx scripts/backfill-telphin-history.ts --from=2024-01-01 --to=2025-06-02
 *   npx tsx scripts/backfill-telphin-history.ts --continue      # с места остановки
 *   npx tsx scripts/backfill-telphin-history.ts --from=... --dry-run
 */
import { supabase } from '@/utils/supabase';
import { fetchTelphin, getTelphinToken } from '@/lib/telphin';
import { formatTelphinDate, telphinCallToRaw } from '@/lib/sync/telphin-map';

const CURSOR_KEY = 'telphin_history_backfill_day';
/** Сколько звонков просим за один заход: у Телфина это предел страницы. */
const PAGE = 100;
/** Пауза между запросами, чтобы не долбить их API. */
const PAUSE_MS = 300;

const arg = (name: string): string | null => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const DRY = has('dry-run');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dayStart = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayEnd = (iso: string) => new Date(`${iso}T23:59:59Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const prevDay = (iso: string) => isoDay(new Date(dayStart(iso).getTime() - 86400000));

async function readCursor(): Promise<string | null> {
    const { data } = await supabase.from('sync_state').select('value').eq('key', CURSOR_KEY).maybeSingle();
    return (data as any)?.value || null;
}

async function writeCursor(day: string): Promise<void> {
    if (DRY) return;
    await supabase.from('sync_state').upsert(
        [{ key: CURSOR_KEY, value: day, updated_at: new Date().toISOString() }],
        { onConflict: 'key' },
    );
}

async function telphinClientId(token: string): Promise<string> {
    const res = await fetchTelphin('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Телфин не отдал пользователя: ${res.status}`);
    return (await res.json()).client_id;
}

/** Все звонки за сутки: страницами, пока Телфин их отдаёт. */
async function callsOfDay(token: string, clientId: string, day: string): Promise<any[]> {
    const rows: any[] = [];
    let cursor = dayStart(day);
    const end = dayEnd(day);

    for (let page = 0; page < 100; page++) {
        const params = new URLSearchParams({
            start_datetime: formatTelphinDate(cursor),
            end_datetime: formatTelphinDate(end),
            order: 'asc',
            count: String(PAGE),
        });
        const res = await fetchTelphin(
            `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params}`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error(`Телфин ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);

        const data = await res.json();
        const batch = data.call_history || (Array.isArray(data) ? data : []);
        if (!batch.length) break;

        rows.push(...batch);
        if (batch.length < PAGE) break;

        // Следующая страница — с секунды после последнего звонка пачки.
        const last = batch[batch.length - 1];
        const lastAt = last.start_time_gmt || last.init_time_gmt || last.bridged_time_gmt;
        if (!lastAt) break;
        const next = new Date(new Date(lastAt + (String(lastAt).includes('Z') ? '' : 'Z')).getTime() + 1000);
        if (!(next > cursor) || next > end) break;
        cursor = next;

        await sleep(PAUSE_MS);
    }

    return rows;
}

(async () => {
    const to = arg('to') || isoDay(new Date());
    let day = has('continue') ? await readCursor() : arg('from') ? to : null;
    const from = arg('from');

    if (!from && !has('continue')) {
        console.error('Укажите --from=ГГГГ-ММ-ДД (начало истории) или --continue');
        process.exit(1);
    }
    // Идём от свежего к старому: нужное сначала.
    if (!day) day = to;
    const stopAt = from || '2021-01-01';

    console.log(`Дотяжка истории Телфина: с ${day} назад до ${stopAt}${DRY ? ' (примерка, ничего не пишем)' : ''}`);

    const token = await getTelphinToken();
    const clientId = await telphinClientId(token);

    let days = 0;
    let saved = 0;
    let withRecord = 0;

    while (day >= stopAt) {
        const rows = await callsOfDay(token, clientId, day);
        const mapped = rows.map(telphinCallToRaw);
        const recs = mapped.filter((row) => row.recording_url).length;

        if (mapped.length && !DRY) {
            // Партиями: один большой upsert Supabase не проглатывает.
            for (let i = 0; i < mapped.length; i += 200) {
                const { error } = await supabase
                    .from('raw_telphin_calls')
                    .upsert(mapped.slice(i, i + 200), { onConflict: 'telphin_call_id' });
                if (error) throw new Error(`Запись не прошла на ${day}: ${error.message}`);
            }
        }

        saved += mapped.length;
        withRecord += recs;
        days++;
        console.log(`${day}: звонков ${mapped.length}, с записью ${recs} (всего ${saved})`);

        await writeCursor(day);
        day = prevDay(day);
        await sleep(PAUSE_MS);
    }

    console.log(`\nГотово. Дней ${days}, звонков ${saved}, из них с записью ${withRecord}.`);
    console.log('Расшифровки не заказывались — это отдельный шаг.');
})();
