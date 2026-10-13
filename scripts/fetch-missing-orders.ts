/**
 * Догрузка заказов, которых нет у нас, но которые есть в RetailCRM.
 *
 * Откуда пропуски: синк заказов просит у CRM заказы, СОЗДАННЫЕ после курсора
 * (`filter[createdAtFrom]`), а курсор двигает по дате ОБНОВЛЕНИЯ. Заказ,
 * созданный давно, в эту выдачу не попадает никогда. Изменения по старым
 * заказам дотягивает синк истории — он вызывает `syncOrderFromRetailCRM` для
 * каждого изменённого, — но то, что накопилось до появления этого вызова, так
 * и осталось: история в базе есть, самого заказа нет.
 *
 * Найдено 09.10.2026 при ревизии ключей: 11 966 заказов из `order_history_log`
 * без строки в `orders`. Список недостающих даёт полная сверка с CRM.
 *
 * Запуск: npx tsx scripts/fetch-missing-orders.ts <missing-orders.json> [--apply]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'fs';
import { syncOrderFromRetailCRM } from '../lib/okk-evaluator';

async function main() {
    const listPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
    const apply = process.argv.includes('--apply');

    if (!listPath) {
        console.error('Нужен путь к списку: npx tsx scripts/fetch-missing-orders.ts <missing-orders.json> [--apply]');
        process.exit(1);
    }

    const list = JSON.parse(readFileSync(listPath, 'utf8')) as Array<{ id: number; number?: string; created?: string }>;
    console.log(`в списке ${list.length} заказов, которых нет у нас`);

    const byYear: Record<string, number> = {};
    for (const order of list) {
        const year = String(order.created ?? '').slice(0, 4) || 'без даты';
        byYear[year] = (byYear[year] ?? 0) + 1;
    }
    console.log('по годам:', byYear);

    if (!apply) {
        console.log('\nЭто пробный прогон. Повторите с --apply, чтобы догрузить.');
        return;
    }

    let done = 0;
    let failed = 0;

    for (const order of list) {
        try {
            // Тянем тем же путём, что и обычная синхронизация: разбор позиций,
            // полей и клиента должен быть один на все заказы.
            const result = await syncOrderFromRetailCRM(Number(order.id));
            if (result) done += 1;
            else failed += 1;
        } catch (e: any) {
            failed += 1;
            if (failed <= 5) console.warn(`  ${order.id}: ${e?.message ?? e}`);
        }

        if ((done + failed) % 100 === 0) {
            console.log(`  ${done + failed}/${list.length}: загружено ${done}, сбоев ${failed}`);
        }
        await new Promise((r) => setTimeout(r, 120));
    }

    console.log(`\nготово: загружено ${done}, сбоев ${failed}`);
}

main();
