/**
 * Привести колонку `orders.customer` к заказчику из карточки заказа.
 *
 * Смена заказчика писала только `raw_payload.customer`, а по колонке работают
 * фильтр и поиск списка заказов (`lib/orders-filter.ts`) — заказ оставался
 * числиться за прежним юрлицом (заказ 900121, Лена Парфёнова 13.10.2026).
 * Сам разъезд закрыт в `lib/own-crm/own-orders.ts`; этот скрипт чинит те
 * заказы, где он уже случился.
 *
 * Запуск: npx tsx scripts/fix-order-customer-column.ts [--apply]
 * Без --apply только показывает, что собирается поправить.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
    const apply = process.argv.includes('--apply');
    const { supabase } = await import('../utils/supabase');

    /**
     * Заказы, у которых заказчика вообще меняли. Сравнить два json-поля
     * запросом нельзя, поэтому перебираем страницами и сверяем у себя.
     */
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('orders')
            .select('id, number, customer, raw_payload')
            .not('customer', 'is', null)
            .order('id', { ascending: false })
            .range(from, from + 999);

        if (error) {
            console.error('не прочиталось:', error.message);
            process.exit(1);
        }

        const page = (data ?? []) as any[];
        rows.push(...page);
        if (page.length < 1000) break;
    }

    const { data, error } = { data: rows, error: null as any };

    if (error) {
        console.error('не прочиталось:', error.message);
        process.exit(1);
    }

    const broken = ((data ?? []) as any[]).filter((row) => {
        const column = row.customer?.id;
        const card = row.raw_payload?.customer?.id;
        return column && card && String(column) !== String(card);
    });

    console.log(`заказов с разошедшимся заказчиком: ${broken.length}`);

    for (const row of broken) {
        console.log(`заказ ${row.number}: ${row.customer.id} → ${row.raw_payload.customer.id} (${row.raw_payload.customer.nickName ?? '—'})`);
        if (!apply) continue;

        const { error: saveError } = await supabase
            .from('orders')
            .update({ customer: row.raw_payload.customer })
            .eq('id', row.id);

        if (saveError) console.error(`  не сохранилось: ${saveError.message}`);
    }

    console.log(apply ? 'готово' : '\nэто предварительный показ, для записи добавьте --apply');
}

void main();
