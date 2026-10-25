/**
 * Пересборка очереди пересчёта баллов: оставить осмысленное, лишнее убрать.
 *
 *   npx tsx scripts/prune-score-queue.ts            # показать, что будет сделано
 *   npx tsx scripts/prune-score-queue.ts --apply    # выполнить
 *
 * ЗАЧЕМ. К 17.10.2026 в очереди лежало 1 159 работ на пересчёт баллов, и 1 157 из
 * них поставила ночная сверка сплошным обходом всех заказов в рабочих статусах.
 * Пересчитывать заказ, по которому ничего не происходило, бессмысленно: оценка
 * выйдет та же, что вчера. При восьми разобранных работах в день такой хвост
 * не рассасывается никогда.
 *
 * ЧТО ОСТАВЛЯЕМ:
 *   — заказы, по которым было событие за последние сутки (смена статуса,
 *     комментарий, правка): их и будет пересчитывать новая ночная сверка;
 *   — заказы ближайшего плана дня: утром по ним дадут совет, оценка нужна свежая.
 *
 * ПОЧЕМУ УДАЛЯЕМ, А НЕ ПОМЕЧАЕМ ВЫПОЛНЕННЫМИ. Пометка «выполнено» соврала бы
 * отчётам: работа не делалась. Снятая работа — это не сбой, поэтому и
 * dead_letter не подходит. Запись просто перестаёт существовать, а заказ при
 * первом же событии вернётся в очередь сам.
 *
 * ПРО ДИСК. Удаляем партиями по 100 с паузой и замером: 16.10.2026 массовое
 * удаление из этой таблицы дважды положило работу отдела (тогда в ней было
 * 623 тысячи строк с раздутыми указателями). Если партия идёт дольше пяти
 * секунд, скрипт останавливается сам и просит перенести работу на ночь.
 */
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const BATCH = 100;
/** Дольше этого партия идти не должна: значит база занята и чистку пора отложить. */
const SLOW_BATCH_MS = 5000;
/** Окно событий — то же, что у ночной сверки. */
const EVENT_WINDOW_HOURS = 30;

function formatCount(value: number): string {
    return value.toLocaleString('ru-RU');
}

async function main() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
    await client.connect();

    try {
        const { rows: before } = await client.query(
            `SELECT count(*)::int waiting FROM system_jobs WHERE status = 'queued' AND job_type = 'order_score_refresh'`,
        );
        console.log(`В очереди на пересчёт баллов: ${formatCount(before[0].waiting)}`);

        // Заказы с событиями за сутки — ровно та же выборка, что у новой сверки.
        const { rows: keepRows } = await client.query(
            `SELECT DISTINCT retailcrm_order_id AS order_id
               FROM order_history_log
              WHERE occurred_at > now() - ($1 || ' hours')::interval
                AND retailcrm_order_id IS NOT NULL`,
            [EVENT_WINDOW_HOURS],
        );
        const keep = new Set<number>(keepRows.map((row: any) => Number(row.order_id)));

        // Заказы ближайшего плана дня: план на сегодня, если он уже собран.
        const { rows: planRows } = await client.query(
            `SELECT DISTINCT order_id FROM sales_rop_task WHERE plan_date >= current_date - 1`,
        );
        for (const row of planRows) keep.add(Number(row.order_id));

        console.log(
            `Оставляем: ${formatCount(keep.size)} заказов ` +
                `(события за ${EVENT_WINDOW_HOURS} ч — ${formatCount(keepRows.length)}, план дня — ${formatCount(planRows.length)})`,
        );

        const { rows: doomed } = await client.query(
            `SELECT id FROM system_jobs
              WHERE status = 'queued' AND job_type = 'order_score_refresh'
                AND NOT ((payload->>'order_id')::bigint = ANY($1::bigint[]))
              ORDER BY id`,
            [Array.from(keep)],
        );

        console.log(`Снять с очереди: ${formatCount(doomed.length)}`);

        if (!APPLY) {
            console.log('\nЭто показ без изменений. Для выполнения: --apply');
            return;
        }

        let removed = 0;
        for (let i = 0; i < doomed.length; i += BATCH) {
            const ids = doomed.slice(i, i + BATCH).map((row: any) => row.id);
            const startedAt = Date.now();
            await client.query(`DELETE FROM system_jobs WHERE id = ANY($1::bigint[])`, [ids]);
            const spent = Date.now() - startedAt;
            removed += ids.length;

            console.log(`  снято ${formatCount(removed)} из ${formatCount(doomed.length)} (партия ${spent} мс)`);

            if (spent > SLOW_BATCH_MS) {
                console.log(
                    `\nПартия шла ${spent} мс — база занята. Останавливаюсь, остальное лучше доделать ночью.`,
                );
                break;
            }

            // Пауза между партиями: диск у базы слабый, очередь не горит.
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        const { rows: after } = await client.query(
            `SELECT count(*)::int waiting FROM system_jobs WHERE status = 'queued' AND job_type = 'order_score_refresh'`,
        );
        console.log(`\nОсталось в очереди: ${formatCount(after[0].waiting)}`);
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error('Не вышло:', error.message);
    process.exit(1);
});
