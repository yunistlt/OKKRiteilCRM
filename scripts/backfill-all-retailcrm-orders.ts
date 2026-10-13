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
 * что и обычный синк, — разбор позиций и полей должен быть один на все заказы.
 *
 * ТОЛЬКО ДОБАВЛЯЕМ. Требование владельца 09.10.2026: «ни один байт не должен
 * быть затёрт». Поэтому перед записью спрашиваем базу, какие из заказов
 * страницы у нас уже есть, и отправляем на запись ТОЛЬКО отсутствующие —
 * существующая строка не участвует в запросе вовсе. Это сильнее, чем полагаться
 * на поведение upsert: тронуть нечего, потому что в запрос ничего не попало.
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
    /** Уже были у нас: в запрос не попадают вовсе. */
    let skipped = 0;
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

        // Какие из этих заказов у нас уже есть — их не трогаем совсем.
        const { supabase } = await import('../utils/supabase');
        const ids = batch.map((o: any) => Number(o.id)).filter((id: number) => Number.isFinite(id));
        const { data: known } = await supabase.from('orders').select('order_id').in('order_id', ids);
        const haveIds = new Set(((known ?? []) as any[]).map((r) => Number(r.order_id)));

        const toInsert = batch.filter((o: any) => !haveIds.has(Number(o.id)));
        skipped += batch.length - toInsert.length;

        // Менеджеры старых заказов: часть людей удалена из RetailCRM совсем
        // (id 9, 29, 53, 57…), и внешний ключ не давал заказу встать. Заказ
        // важнее: заводим запись о таком менеджере — честно, без выдуманного
        // имени, и неактивной, чтобы она не попадала в рабочие списки
        // (закон «только активные сущности»).
        const managerIds = Array.from(new Set(
            toInsert.map((o: any) => Number(o.managerId)).filter((id: number) => Number.isFinite(id) && id > 0),
        ));
        if (managerIds.length) {
            const { data: knownManagers } = await supabase.from('managers').select('id').in('id', managerIds);
            const haveManagers = new Set(((knownManagers ?? []) as any[]).map((r) => Number(r.id)));
            const missingManagers = managerIds.filter((id) => !haveManagers.has(id));

            if (missingManagers.length) {
                await supabase.from('managers').insert(missingManagers.map((id) => ({
                    id,
                    first_name: `Менеджер №${id}`,
                    last_name: '(удалён из RetailCRM)',
                    active: false,
                    own_crm: false,
                })));
                console.log(`  восстановлены ссылки на менеджеров: ${missingManagers.join(', ')}`);
            }
        }

        if (toInsert.length) {
            try {
                await upsertRetailCrmOrders(toInsert);
                saved += toInsert.length;
            } catch (e: any) {
                // Пачка не легла целиком — пробуем по одному, чтобы один кривой
                // заказ не уносил сотню нормальных.
                for (const order of toInsert) {
                    try {
                        await upsertRetailCrmOrders([order]);
                        saved += 1;
                    } catch (inner: any) {
                        failed += 1;
                        if (failed <= 10) console.warn(`  заказ ${order?.id}: ${inner?.message ?? inner}`);
                    }
                }
            }
        }

        if (page % 20 === 0 || page === fromPage) {
            console.log(`  страница ${page}${totalPages ? '/' + totalPages : ''}: добавлено ${saved}, пропущено (уже есть) ${skipped}, сбоев ${failed}`);
        }

        if (totalPages && page >= totalPages) break;
        page += 1;
        // Не частим: у RetailCRM есть предел обращений в секунду.
        await new Promise((r) => setTimeout(r, 250));
    }

    const after = await ordersInBase();
    console.log(`\nготово: добавлено ${saved}, пропущено как существующие ${skipped}, сбоев ${failed}`);
    console.log(`заказов в базе: было ${before}, стало ${after} (+${after - before})`);
}

main();
