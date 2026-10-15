/**
 * Докачка ПОЛНОЙ истории заказов из RetailCRM за годы до 2025.
 *
 * Зачем: order_history_log до 01.01.2025 содержит только смены статуса —
 * прошлый бэкфил тянул ровно field='status'. Из-за этого в карточке старого
 * заказа нет ни комментариев менеджера, ни правок состава, ни смен
 * ответственного: жалоба по заказу 32321 (15.10.2026) — в RetailCRM 66
 * записей, у нас 5. Забрать надо до конца лицензии RetailCRM.
 *
 * Как: лента /orders/history идёт сплошным курсором filter[sinceId]. Один
 * поток, пачки по 100 строк, ночное окно и сторожа темпа и диска — см.
 * scripts/_safe-pace.ts и инцидент, из-за которого они появились.
 *
 * Проход начинается с нуля даже когда часть истории уже лежит: ON CONFLICT
 * переписывает user_data из первоисточника и тем выпрямляет 149 749 строк,
 * где автор правки лежит JSON-СТРОКОЙ ("{\"id\":10}") вместо объекта и
 * карточка показывает «Система» вместо имени. Переписываются ТОЛЬКО кривые
 * строки: лишнее обновление в Postgres плодит мёртвые версии и раздувает
 * таблицу, а диска на MICRO почти не осталось.
 *
 * Запуск:  npx tsx --env-file=.env.local scripts/backfill-order-history-full.ts [--stop-id N] [--dry] [--now]
 * Резюмируемый: пройденный курсор лежит в scratch/backfill-history-progress.json.
 *   --now  — не ждать ночи (только для короткой проверки, не для полного прогона)
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { BATCH_SIZE, PaceGuard, canWorkNow, databaseSizeMb, describeWindow } from './_safe-pace';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NOW = args.includes('--now');
const STOP_ID = (() => {
    const i = args.indexOf('--stop-id');
    // 2052729 — последний идентификатор истории до 01.01.2025.
    return i >= 0 ? Number(args[i + 1]) : 2052729;
})();

const PROGRESS_FILE = path.join('scratch', 'backfill-history-progress.json');
const BASE = (process.env.RETAILCRM_URL || '').replace(/\/+$/, '');
const KEY = process.env.RETAILCRM_API_KEY;
if (!BASE || !KEY) throw new Error('RETAILCRM_URL / RETAILCRM_API_KEY отсутствуют');

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 2 });
const guard = new PaceGuard(sql);

type Progress = { sinceId: number };
const progress: Progress = fs.existsSync(PROGRESS_FILE)
    ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    : { sinceId: 0 };
// Прогресс прошлой, многопоточной версии здесь не читается: формат другой.
if (typeof progress.sinceId !== 'number') progress.sinceId = 0;

function saveProgress() {
    if (DRY) return;
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 1));
}

async function fetchPage(sinceId: number) {
    const p = new URLSearchParams({
        apiKey: KEY!,
        limit: String(BATCH_SIZE),
        'filter[sinceId]': String(sinceId),
    });
    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(`${BASE}/api/v5/orders/history?${p}`);
        if (res.status === 503 || res.status === 429) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error('success=false');
        return (j.history || []) as any[];
    }
    throw new Error('не отдаёт после 6 попыток');
}

function toRow(it: any) {
    if (!it.order?.id) return null;
    return {
        retailcrm_history_id: it.id,
        retailcrm_order_id: it.order.id,
        field: it.field,
        old_value: typeof it.oldValue === 'object' ? JSON.stringify(it.oldValue) : String(it.oldValue ?? ''),
        new_value: typeof it.newValue === 'object' ? JSON.stringify(it.newValue) : String(it.newValue ?? ''),
        // Через sql.json, иначе драйвер сериализует объект второй раз и автор
        // ложится в jsonb строкой — та самая «Система» в карточке.
        user_data: it.user ? sql.json(it.user) : null,
        occurred_at: it.createdAt,
    };
}

async function main() {
    if (!NOW && !canWorkNow()) {
        console.log(`Сейчас не время работы. Прогон дождётся своего окна и пойдёт сам: ${describeWindow()}. Окно терминала можно не закрывать.`);
    }
    console.log(`Докачка истории до id ${STOP_ID}${DRY ? ' (dry-run)' : ''}, старт с ${progress.sinceId}. База сейчас ${await databaseSizeMb(sql)} МБ.`);

    let fetched = 0;
    let written = 0;
    const started = Date.now();
    let lastReport = Date.now();

    for (;;) {
        if (!NOW && !(await guard.beforeBatch())) break;

        let page: any[];
        try {
            page = await fetchPage(progress.sinceId);
        } catch (e: any) {
            console.error(`sinceId=${progress.sinceId}: ${e.message}`);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }
        if (!page.length) break;

        const kept = page.filter((it) => it.id <= STOP_ID);
        const rows = kept.map(toRow).filter(Boolean) as any[];

        if (rows.length && !DRY) {
            const t0 = Date.now();
            await sql`
                INSERT INTO order_history_log ${sql(rows, 'retailcrm_history_id', 'retailcrm_order_id', 'field', 'old_value', 'new_value', 'user_data', 'occurred_at')}
                ON CONFLICT (retailcrm_history_id) DO UPDATE SET user_data = EXCLUDED.user_data
                WHERE jsonb_typeof(order_history_log.user_data) = 'string'
            `;
            guard.afterBatch(Date.now() - t0);
            if (guard.stopped) break;
        }

        fetched += page.length;
        written += rows.length;
        progress.sinceId = page[page.length - 1].id;

        if (Date.now() - lastReport >= 30_000) {
            const min = ((Date.now() - started) / 60000).toFixed(1);
            const left = Math.max(0, STOP_ID - progress.sinceId);
            console.log(`  ${min} мин: получено ${fetched}, записано ${written}, курсор ${progress.sinceId}, осталось ~${left}`);
            saveProgress();
            lastReport = Date.now();
        }

        if (kept.length < page.length || progress.sinceId >= STOP_ID) break;
    }

    saveProgress();
    console.log(`Готово за ${((Date.now() - started) / 60000).toFixed(1)} мин. Получено ${fetched}, записано ${written}. База ${await databaseSizeMb(sql)} МБ.${guard.stopped ? ` Остановлено: ${guard.stopped}` : ''}`);
    await sql.end();
}

main();
