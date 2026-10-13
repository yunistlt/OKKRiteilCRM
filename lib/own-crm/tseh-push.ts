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
 *
 * Оповещение «заказ заведён, проверьте оформление» шлёт САМ ЦехУспех: событие происходит у него,
 * и бот у него уже настроен. У нас в окружении токена бота нет — те системные сообщения, что
 * видно в Telegram, отправляет отдельный сторож с другой машины (ops/watchdog), а не это
 * приложение. Решение владельца 05.10.2026: в Vercel ничего не добавляем.
 */
import type { Sql } from 'postgres';
import { productionItems } from './tseh-outbox';

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
    production_days_unit: string | null;
    shipping_terms: string | null;
    seller_name: string | null;
    seller_inn: string | null;
    seller_account: string | null;
    seller_bank: string | null;
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

/** Отправка одной строки очереди: тело запроса у отдачи и у досылки одно и то же. */
async function sendOrder(url: string, key: string, row: OutboxRow): Promise<Response> {
    return fetch(`${url.replace(/\/$/, '')}/api/external/okk/orders`, {
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
            // В каких днях назван срок: 'kalendarnye' или 'rabochie'. Без этого
            // ЦехУспех считал срок рабочими днями, а менеджер называл клиенту
            // календарные — на 40 днях расхождение в две недели (06.10.2026).
            productionDaysUnit: row.production_days_unit || 'kalendarnye',
            shippingTerms: row.shipping_terms,
            // Наше юрлицо: поставщик в карточке ЦехУспеха и реквизиты, на которые
            // пришла оплата. Раньше не передавались, и поле оставалось пустым.
            sellerName: row.seller_name,
            sellerInn: row.seller_inn,
            sellerAccount: row.seller_account,
            sellerBank: row.seller_bank,
            // Позиции уезжают как лежат в очереди: название, количество, цена и
            // адреса фото/карточки товара (`imageUrl`, `productUrl` — ТЗ 12.10.2026).
            items: Array.isArray(row.items) ? row.items : [],
            totalSumm: row.total_summ === null ? null : Number(row.total_summ),
            managerComment: row.manager_comment,
        }),
        signal: AbortSignal.timeout(30_000),
    });
}

export async function pushProductionQueue(sql: Sql, limit = BATCH): Promise<PushResult> {
    const url = process.env.TSEH_API_URL;
    const key = process.env.TSEH_API_KEY;
    // Ключей нет — значит связь в этом окружении не настроена. Это не сбой: на превью-стендах
    // её и не должно быть, и крон не должен изображать работу.
    if (!url || !key) return { taken: 0, accepted: 0, rejected: 0, failed: 0, skipped: 'нет TSEH_API_URL/TSEH_API_KEY' };

    const rows = (await sql`
        SELECT id, order_number, order_id, customer_name, customer_inn, manager_name,
               production_days, production_days_unit, shipping_terms,
               seller_name, seller_inn, seller_account, seller_bank,
               items, total_summ, manager_comment
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
            const res = await sendOrder(url, key, row);

            const body = await res.json().catch(() => ({}) as Record<string, unknown>);

            if (res.ok && (body as { tsehOrderNo?: string }).tsehOrderNo) {
                const no = String((body as { tsehOrderNo?: string }).tsehOrderNo);
                await sql`
                    UPDATE tseh_production_outbox
                    SET tseh_order_no = ${no}, processed_at = now(), error = NULL
                    WHERE id = ${row.id}
                `;
                out.accepted++;
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

export type BackfillResult = {
    /** Сколько заказов взяли в этот проход. */
    taken: number;
    /** Сколько обновили: ЦехУспех принял адреса. */
    updated: number;
    /** У скольких заказов адресов не нашлось — у этих товаров нет карточки на сайте. */
    withoutUrls: number;
    /** Сколько не доехало из-за связи — попадут в следующий проход. */
    failed: number;
    skipped?: string;
};

/**
 * Досылка фото товара и ссылки на карточку по УЖЕ заведённым заказам.
 *
 * Состав в очереди — снимок на момент постановки, и у заказов, уехавших до 12.10.2026,
 * в позициях нет ни `imageUrl`, ни `productUrl`: в перечне заказа ЦехУспеха у них пусто.
 * Повторная отправка того же заказа дубля там не создаёт — ЦехУспех сверяется по номеру
 * и обновляет адреса в карточке номенклатуры, поэтому заказ достаточно переотправить.
 *
 * Берём только заказы, которые у них ЗАВЕЛИСЬ (`tseh_order_no IS NOT NULL`): отказанные
 * повторять нечего, их причина сама не исправится.
 *
 * Отличаем «ещё не досылали» по самим позициям: как только в первой появился ключ
 * `imageUrl`, заказ в выборку больше не попадает. Отдельного признака в очереди для
 * этого не нужно, и адрес у позиции без карточки на сайте остаётся пустым (`null`) —
 * пустое поле у ЦехУспеха ничего не затирает.
 */
export async function backfillProductionImages(
    sql: Sql,
    limit = BATCH,
    orderNumbers: string[] = [],
): Promise<BackfillResult> {
    const url = process.env.TSEH_API_URL;
    const key = process.env.TSEH_API_KEY;
    if (!url || !key) return { taken: 0, updated: 0, withoutUrls: 0, failed: 0, skipped: 'нет TSEH_API_URL/TSEH_API_KEY' };

    const take = Math.max(1, Math.min(limit, BATCH));

    // Названы конкретные заказы — шлём их независимо от отметки. Отметка говорит, что мы
    // досылали, а не что у них записалось: 12.10.2026 ЦехУспех принимал повторный заказ,
    // но до позиций не доходил, и адреса у него оставались пустыми. После починки на их
    // стороне такие заказы надо переотправить поимённо.
    const rows = (orderNumbers.length
        ? await sql`
            SELECT id, order_number, order_id, customer_name, customer_inn, manager_name,
                   production_days, production_days_unit, shipping_terms,
                   seller_name, seller_inn, seller_account, seller_bank,
                   items, total_summ, manager_comment
            FROM tseh_production_outbox
            WHERE tseh_order_no IS NOT NULL
              AND order_number = ANY(${orderNumbers})
            ORDER BY created_at DESC
            LIMIT ${take}
        `
        : await sql`
            SELECT id, order_number, order_id, customer_name, customer_inn, manager_name,
                   production_days, production_days_unit, shipping_terms,
                   seller_name, seller_inn, seller_account, seller_bank,
                   items, total_summ, manager_comment
            FROM tseh_production_outbox
            WHERE tseh_order_no IS NOT NULL
              AND jsonb_typeof(items) = 'array'
              AND jsonb_array_length(items) > 0
              AND NOT (items -> 0 ? 'imageUrl')
            ORDER BY created_at DESC
            LIMIT ${take}
        `) as unknown as OutboxRow[];

    const out: BackfillResult = { taken: rows.length, updated: 0, withoutUrls: 0, failed: 0 };

    for (const row of rows) {
        try {
            // Состав пересобираем тем же кодом, что готовит счёт: адреса фото и карточки
            // приходят оттуда вместе с составом, отдельного запроса в каталог не нужно.
            const items = row.order_id === null ? [] : await productionItems(Number(row.order_id));
            if (!items.length) {
                out.failed++;
                await sql`UPDATE tseh_production_outbox SET error = ${'досылка картинок: состав заказа не собрался'} WHERE id = ${row.id}`;
                continue;
            }

            const res = await sendOrder(url, key, { ...row, items });
            const body = await res.json().catch(() => ({}) as Record<string, unknown>);

            if (!res.ok || !(body as { tsehOrderNo?: string }).tsehOrderNo) {
                const reason = String((body as { error?: string }).error || `ЦехУспех ответил ${res.status}`);
                await sql`UPDATE tseh_production_outbox SET error = ${`досылка картинок: ${reason}`} WHERE id = ${row.id}`;
                out.failed++;
                continue;
            }

            // Пишем новый состав в очередь: по нему видно, что досылка прошла, и повторно
            // этот заказ уже не возьмётся.
            await sql`
                UPDATE tseh_production_outbox
                SET items = ${sql.json(items)}, error = NULL
                WHERE id = ${row.id}
            `;
            out.updated++;
            if (!items.some((item) => item.imageUrl || item.productUrl)) out.withoutUrls++;
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            await sql`UPDATE tseh_production_outbox SET error = ${`досылка картинок: ${reason}`} WHERE id = ${row.id}`;
            out.failed++;
        }
    }

    return out;
}
