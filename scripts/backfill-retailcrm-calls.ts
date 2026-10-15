/**
 * Разовая докачка архива звонков из RetailCRM в retailcrm_calls.
 *
 * Зачем: боевой синк (lib/retailcrm/calls.ts) ходит с горизонтом 120 дней,
 * поэтому у нас лежат звонки только с 13.02.2026 — 20 341 штука. В RetailCRM
 * их больше полумиллиона, с 2015 года, и у каждого проставлен номер заказа.
 * Из-за этого в карточке старого заказа пусто: жалоба по заказу 32321
 * (15.10.2026) — в RetailCRM по клиенту видно разговоры 2023–2024 годов с
 * записями, у нас ни одного. Забрать надо сейчас: лицензия RetailCRM истекает.
 *
 * Как: /telephony/calls фильтруется датой и отдаёт курсор. Берём помесячно,
 * с 2015-го по текущий месяц — месяц обходится своим курсором, воркеры идут
 * по разным месяцам. Маппинг полей общий с боевым синком (mapCall).
 *
 * Аудио RetailCRM не отдаёт: тут только инвентарь разговоров. Записи 2023-2024
 * годов в Телфине уже стёрты по сроку хранения (проверено 15.10.2026), живыми
 * остаются только внутри RetailCRM — это отдельная работа.
 *
 * Пишем напрямую в Postgres, а не через Supabase REST: REST ходит через
 * Cloudflare с коротким потолком ожидания и под нагрузкой отдаёт 522 вместо
 * ответа — на этом прогон уже падал.
 *
 * Темп: один поток, пачки по 100, ночное окно и сторожа темпа и диска —
 * см. scripts/_safe-pace.ts и инцидент 15.10.2026, из-за которого они есть.
 *
 * Запуск:  npx tsx --env-file=.env.local scripts/backfill-retailcrm-calls.ts [--dry] [--now]
 * Резюмируемый: пройденные месяцы отмечаются в scratch/backfill-calls-progress.json.
 *   --now  — не ждать ночи (только для короткой проверки).
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { mapCall } from '@/lib/retailcrm/calls';
import { BATCH_SIZE, PaceGuard, canWorkNow, databaseSizeMb, describeWindow } from './_safe-pace';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NOW = args.includes('--now');
const FROM_MONTH = (() => {
    const i = args.indexOf('--from');
    return i >= 0 ? String(args[i + 1]) : '2015-01';
})();

const PROGRESS_FILE = path.join('scratch', 'backfill-calls-progress.json');
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 2 });
const guard = new PaceGuard(sql);

const COLUMNS = [
    'rc_call_id', 'external_id', 'record_uuid', 'call_type', 'call_date', 'ext_code',
    'manager_rc_id', 'manager_name', 'phone', 'phone_normalized', 'order_number',
    'customer_rc_id', 'is_missed', 'duration_sec', 'result', 'raw_payload', 'updated_at',
] as const;

/**
 * Пачка звонков в retailcrm_calls. raw_payload идёт через sql.json: без него
 * драйвер сериализует объект второй раз и в jsonb ложится строка.
 */
async function upsertCalls(rows: any[]) {
    const prepared = rows.map((r) => ({ ...r, raw_payload: sql.json(r.raw_payload) }));
    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
        const chunk = prepared.slice(i, i + BATCH_SIZE);
        for (let attempt = 0; ; attempt++) {
            const t0 = Date.now();
            try {
                await sql`
                    INSERT INTO retailcrm_calls ${sql(chunk, ...COLUMNS)}
                    ON CONFLICT (rc_call_id) DO UPDATE SET
                        external_id = EXCLUDED.external_id,
                        record_uuid = EXCLUDED.record_uuid,
                        call_type = EXCLUDED.call_type,
                        call_date = EXCLUDED.call_date,
                        ext_code = EXCLUDED.ext_code,
                        manager_rc_id = EXCLUDED.manager_rc_id,
                        manager_name = EXCLUDED.manager_name,
                        phone = EXCLUDED.phone,
                        phone_normalized = EXCLUDED.phone_normalized,
                        order_number = EXCLUDED.order_number,
                        customer_rc_id = EXCLUDED.customer_rc_id,
                        is_missed = EXCLUDED.is_missed,
                        duration_sec = EXCLUDED.duration_sec,
                        result = EXCLUDED.result,
                        raw_payload = EXCLUDED.raw_payload,
                        updated_at = EXCLUDED.updated_at
                `;
                guard.afterBatch(Date.now() - t0);
                break;
            } catch (e: any) {
                // База под нагрузкой — ждём и пробуем снова, а не роняем прогон.
                if (attempt >= 5) throw e;
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
        }
        if (guard.stopped) return;
    }
}
const BASE = (process.env.RETAILCRM_URL || '').replace(/\/+$/, '');
const KEY = process.env.RETAILCRM_API_KEY;
if (!BASE || !KEY) throw new Error('RETAILCRM_URL / RETAILCRM_API_KEY отсутствуют');

type Progress = Record<string, 'done' | string>;
const progress: Progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    : {};

function saveProgress() {
    // Холостой прогон ничего не записал в базу — отмечать месяцы пройденными
    // нельзя, иначе боевой запуск их пропустит.
    if (DRY) return;
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 1));
}

/** Месяцы от FROM_MONTH до текущего включительно: ['2015-01', …]. */
function months(): string[] {
    const out: string[] = [];
    const [y0, m0] = FROM_MONTH.split('-').map(Number);
    const now = new Date();
    let y = y0;
    let m = m0;
    for (;;) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        if (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1)) break;
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

function monthBounds(month: string): { from: string; to: string } {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

async function fetchPage(from: string, to: string, cursor?: string) {
    const p = new URLSearchParams({
        apiKey: KEY!,
        limit: String(BATCH_SIZE),
        'filter[dateFrom]': from,
        'filter[dateTo]': to,
    });
    if (cursor) p.set('cursor', cursor);

    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(`${BASE}/api/v5/telephony/calls?${p}`);
        if (res.status === 503 || res.status === 429) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error(j.errorMsg || 'success=false');
        return { calls: (j.calls || []) as any[], next: j.pagination?.nextCursor as string | undefined };
    }
    throw new Error('не отдаёт после 6 попыток');
}

let fetched = 0;
let upserted = 0;
let failed = 0;
const started = Date.now();

async function handleMonth(month: string) {
    if (progress[month] === 'done') return;
    const { from, to } = monthBounds(month);
    let cursor = typeof progress[month] === 'string' && progress[month] !== 'done'
        ? (progress[month] as string)
        : undefined;

    for (;;) {
        // Окно и темп проверяем на каждой странице, а не раз в месяц: в
        // большом месяце страниц полсотни, и прогон обязан встать посреди
        // месяца, если окно закрылось или база напряглась.
        if (!NOW && !(await guard.beforeBatch())) return;

        let page;
        try {
            page = await fetchPage(from, to, cursor);
        } catch (e: any) {
            failed++;
            console.error(`${month}: ${e.message}`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
        }

        if (!page.calls.length) break;
        fetched += page.calls.length;

        const rows = page.calls.map(mapCall).filter((r) => r.rc_call_id != null);
        if (rows.length && !DRY) {
            await upsertCalls(rows);
            upserted += rows.length;
        }

        if (!page.next) break;
        cursor = page.next;
        progress[month] = cursor;
    }

    progress[month] = 'done';
}

async function main() {
    const queue = months().filter((m) => progress[m] !== 'done');
    if (!NOW && !canWorkNow()) {
        console.log(`Сейчас не время работы. Прогон дождётся своего окна и пойдёт сам: ${describeWindow()}. Окно терминала можно не закрывать.`);
    }
    console.log(`Докачка звонков${DRY ? ' (dry-run)' : ''}: месяцев в очереди ${queue.length}. База сейчас ${await databaseSizeMb(sql)} МБ.`);

    const ticker = setInterval(() => {
        const min = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`  ${min} мин: получено ${fetched}, записано ${upserted}, ошибок ${failed}`);
        saveProgress();
    }, 30000);

    for (const month of queue) {
        if (!NOW && !(await guard.beforeBatch())) break;
        if (guard.stopped) break;
        await handleMonth(month);
    }

    clearInterval(ticker);
    saveProgress();
    console.log(`Готово за ${((Date.now() - started) / 60000).toFixed(1)} мин. Получено ${fetched}, записано ${upserted}, ошибок ${failed}. База ${await databaseSizeMb(sql)} МБ.${guard.stopped ? ` Остановлено: ${guard.stopped}` : ''}`);
    await sql.end();
}

main();
