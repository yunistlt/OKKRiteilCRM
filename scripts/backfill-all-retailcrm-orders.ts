/**
 * Полная выгрузка заказов из RetailCRM в нашу базу.
 *
 * Зачем. Обычный синк просит у CRM заказы, СОЗДАННЫЕ после курсора
 * (`filter[createdAtFrom]`), а курсор двигает по дате ОБНОВЛЕНИЯ. Заказ,
 * созданный давно, в эту выдачу не попадает никогда — значит всё, что было до
 * запуска синхронизации, к нам так и не приехало. На 09.10.2026 в RetailCRM
 * 37 512 заказов, у нас 30 954: не хватает 6 558.
 *
 * Решение владельца: забрать из RetailCRM всё.
 *
 * Идём постранично от свежих к старым и кладём тем же `upsertRetailCrmOrders`,
 * что и обычный синк, — разбор позиций, полей и клиента должен быть один на
 * все заказы. Повторный запуск безопасен: upsert по идентификатору.
 *
 * Запуск: npx tsx scripts/backfill-all-retailcrm-orders.ts [--from-page=N]
 */
import { config } from 'dotenv';

// Окружение читаем ДО того, как подтянутся модули с ключами: они берут их
// на этапе импорта, и статический import отработал бы раньше config().
config({ path: '.env.local' });

async function ordersInBase(): Promise<number> {
    const { supabase } = await import('../utils/supabase');
    const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .lt('order_id', 900000000);
    return Number(count ?? 0);
}

async function main() {
    // Импорт после загрузки окружения: модули читают ключи при импорте.
    const { fetchRetailCrmOrdersPage, upsertRetailCrmOrders } = await import('../lib/retailcrm/orders');

    const fromPage = Number(process.argv.find((a) => a.startsWith('--from-page='))?.split('=')[1] ?? 1);

    const before = await ordersInBase();
    console.log(`заказов в базе до выгрузки: ${before}`);

    let page = fromPage;
    let saved = 0;
    let failed = 0;
    let totalPages: number | null = null;

    while (true) {
        let batch: any[] = [];
        try {
            const data = await fetchRetailCrmOrdersPage({ page, limit: 100 });
            batch = data.orders ?? [];
            totalPages = data.pagination?.totalPageCount ?? totalPages;
        } catch (e: any) {
            console.warn(`  страница ${page}: ${e?.message ?? e} — повтор через 3 с`);
            await new Promise((r) => setTimeout(r, 3000));
            continue;
        }

        if (!batch.length) break;

        try {
            await upsertRetailCrmOrders(batch);
            saved += batch.length;
        } catch (e: any) {
            // Пачка не легла целиком — пробуем по одному, чтобы один кривой
            // заказ не уносил сотню нормальных.
            for (const order of batch) {
                try {
                    await upsertRetailCrmOrders([order]);
                    saved += 1;
                } catch (inner: any) {
                    failed += 1;
                    if (failed <= 10) console.warn(`  заказ ${order?.id}: ${inner?.message ?? inner}`);
                }
            }
        }

        if (page % 20 === 0 || page === fromPage) {
            console.log(`  страница ${page}${totalPages ? '/' + totalPages : ''}: записано ${saved}, сбоев ${failed}`);
        }

        if (totalPages && page >= totalPages) break;
        page += 1;
        // Не частим: у RetailCRM есть предел обращений в секунду.
        await new Promise((r) => setTimeout(r, 250));
    }

    const after = await ordersInBase();
    console.log(`\nготово: обработано ${saved}, сбоев ${failed}`);
    console.log(`заказов в базе: было ${before}, стало ${after} (+${after - before})`);
}

main();
