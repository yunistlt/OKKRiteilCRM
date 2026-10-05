/**
 * Отправка очереди заказов в ЦехУспех.
 *
 * Очередь (`tseh_production_outbox`) живёт у нас — см. docs/tseh-integration/OVERVIEW.md.
 * Изначально предполагалось, что ЦехУспех придёт к нам на чтение и заберёт её сам. Решение
 * владельца 04.10.2026: забирать не он, а шлём мы — ЦехУспех поднял у себя внешний API с
 * ключом, и никому не нужна учётка в чужой базе: ни им у нас, ни нам у них.
 *
 * Отправляем строки, по которым ещё нет ответа (`processed_at IS NULL`), и кладём ответ в те же
 * поля очереди, что и раньше: `tseh_order_no` + `processed_at`, либо `error` с причиной.
 * Повторная отправка того же заказа у них дубля не создаёт — они сверяются по номеру заказа,
 * поэтому сбой связи безопасен: заказ просто уедет на следующем проходе.
 */
import type { Sql } from 'postgres';
import { sendNotification } from '@/lib/notify/send';

export type PushResult = {
    /** Сколько строк взяли из очереди в этот проход. */
    taken: number;
    /** Сколько ЦехУспех завёл у себя. */
    accepted: number;
    /** Сколько отклонил с причиной (например, у заказчика нет ИНН). */
    rejected: number;
    /** Сколько не доехало из-за связи — останутся в очереди до следующего прохода. */
    failed: number;
    skipped?: string;
};

type OutboxRow = {
    id: number;
    order_number: string;
    order_id: number | null;
    customer_name: string | null;
    customer_inn: string | null;
    manager_name: string | null;
    production_days: number | null;
    shipping_terms: string | null;
    items: unknown;
    total_summ: string | number | null;
    manager_comment: string | null;
};

/**
 * Сколько заказов отдаём за один проход: крон частый, очередь обычно пустая.
 * Меньшую партию можно задать вручную (`?limit=1`) — так пускают первый заказ,
 * когда связь только включили и хотят посмотреть результат, прежде чем открывать поток.
 */
const BATCH = 20;

/** Оповещение не должно мешать передаче заказа: сбой телеграма пишем в журнал и идём дальше. */
async function notify(code: string, text: string): Promise<void> {
    try {
        await sendNotification(code, text);
    } catch (e) {
        console.error('[tseh-push] оповещение не ушло:', code, e instanceof Error ? e.message : e);
    }
}

export async function pushProductionQueue(sql: Sql, limit = BATCH): Promise<PushResult> {
    const url = process.env.TSEH_API_URL;
    const key = process.env.TSEH_API_KEY;
    // Ключей нет — значит связь в этом окружении не настроена. Это не сбой: на превью-стендах
    // её и не должно быть, и крон не должен изображать работу.
    if (!url || !key) return { taken: 0, accepted: 0, rejected: 0, failed: 0, skipped: 'нет TSEH_API_URL/TSEH_API_KEY' };

    const rows = (await sql`
        SELECT id, order_number, order_id, customer_name, customer_inn, manager_name,
               production_days, shipping_terms, items, total_summ, manager_comment
        FROM tseh_production_outbox
        WHERE processed_at IS NULL
        ORDER BY created_at
        LIMIT ${Math.max(1, Math.min(limit, BATCH))}
    `) as unknown as OutboxRow[];

    const out: PushResult = { taken: rows.length, accepted: 0, rejected: 0, failed: 0 };

    for (const row of rows) {
        // Отметка «взяли в работу» — чтобы по очереди было видно, что заказ не лежит забытым.
        await sql`UPDATE tseh_production_outbox SET taken_at = now() WHERE id = ${row.id}`;

        try {
            const res = await fetch(`${url.replace(/\/$/, '')}/api/external/okk/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
                body: JSON.stringify({
                    orderNumber: row.order_number,
                    // Драйвер отдаёт bigint СТРОКОЙ — отправляем числом, иначе приёмная
                    // сторона не разбирает заказ («The JSON value could not be converted»).
                    orderId: row.order_id === null ? null : Number(row.order_id),
                    customerName: row.customer_name,
                    customerInn: row.customer_inn,
                    managerName: row.manager_name,
                    productionDays: row.production_days,
                    shippingTerms: row.shipping_terms,
                    items: Array.isArray(row.items) ? row.items : [],
                    totalSumm: row.total_summ === null ? null : Number(row.total_summ),
                    managerComment: row.manager_comment,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            const body = await res.json().catch(() => ({}) as Record<string, unknown>);

            if (res.ok && (body as { tsehOrderNo?: string }).tsehOrderNo) {
                const no = String((body as { tsehOrderNo?: string }).tsehOrderNo);
                await sql`
                    UPDATE tseh_production_outbox
                    SET tseh_order_no = ${no}, processed_at = now(), error = NULL
                    WHERE id = ${row.id}
                `;
                out.accepted++;
                // Техническое оповещение: заказ уехал в производство, пора проверить оформление
                // (решение владельца 05.10.2026). Сбой отправки не трогает саму передачу заказа.
                await notify('tseh.order_accepted',
                    `Заказ № ${row.order_number} заведён в ЦехУспехе под № ${no}.\n`
                    + `Заказчик: ${row.customer_name || '—'}\n`
                    + `Сумма: ${row.total_summ ?? '—'}\n`
                    + 'Проверьте оформление: состав, сроки, реквизиты заказчика.');
                continue;
            }

            const reason = String((body as { error?: string }).error || `ЦехУспех ответил ${res.status}`);

            // Отказ по сути заказа (нет ИНН, не разобрали состав) — заказ в очереди закрываем
            // и показываем причину менеджеру: сам по себе он не исправится.
            // Отказ по доступу или сбою на их стороне — оставляем в очереди, уедет позже.
            const permanent = res.status === 400;
            if (permanent) {
                await sql`
                    UPDATE tseh_production_outbox
                    SET error = ${reason}, processed_at = now()
                    WHERE id = ${row.id}
                `;
                out.rejected++;
                await notify('tseh.order_rejected',
                    `Заказ № ${row.order_number} НЕ принят производством.\n`
                    + `Заказчик: ${row.customer_name || '—'}\n`
                    + `Причина: ${reason}`);
            } else {
                await sql`UPDATE tseh_production_outbox SET error = ${reason} WHERE id = ${row.id}`;
                out.failed++;
            }
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            await sql`UPDATE tseh_production_outbox SET error = ${`связь с ЦехУспехом: ${reason}`} WHERE id = ${row.id}`;
            out.failed++;
        }
    }

    return out;
}
