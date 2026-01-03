import { supabase } from '../utils/supabase';

/**
 * Полная миграция данных из orders в raw_order_events
 * Создаём события на основе существующих заказов
 */

async function migrateOrdersToRawEvents() {
    console.log('=== MIGRATING orders → raw_order_events ===\n');

    // 1. Получить все заказы
    let allOrders: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data: batch, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error('❌ Error fetching orders:', error);
            break;
        }

        if (!batch || batch.length === 0) break;

        allOrders = [...allOrders, ...batch];
        console.log(`Fetched ${allOrders.length} orders...`);

        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    console.log(`\n📊 Total orders to process: ${allOrders.length}\n`);

    // 2. Создать события для каждого заказа
    const events: any[] = [];

    for (const order of allOrders) {
        const payload = order.raw_payload || {};

        // Событие создания заказа
        events.push({
            retailcrm_order_id: order.order_id,
            event_type: 'order_created',
            occurred_at: order.created_at,
            source: 'retailcrm',
            raw_payload: {
                ...payload,
                order_number: order.number,
                status: order.status,
                manager_id: order.manager_id,
                phone: payload.phone || order.phone,
                additional_phone: payload.additional_phone,
                total_sum: order.totalsumm
            }
        });

        // Если есть updated_at и он отличается от created_at, создаём событие обновления
        if (order.updated_at && order.updated_at !== order.created_at) {
            events.push({
                retailcrm_order_id: order.order_id,
                event_type: 'status_changed',
                occurred_at: order.updated_at,
                source: 'retailcrm',
                raw_payload: {
                    status: order.status,
                    manager_id: order.manager_id,
                    phone: payload.phone || order.phone
                }
            });
        }
    }

    console.log(`Created ${events.length} events from orders\n`);

    // 3. Вставить батчами
    const batchSize = 1000;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);

        const { data, error } = await supabase
            .from('raw_order_events')
            .insert(batch)
            .select();

        if (error) {
            if (error.message?.includes('unique') || error.code === '23505') {
                console.log(`⚠️  Batch ${Math.floor(i / batchSize) + 1}: Duplicates skipped`);
                skipped += batch.length;
            } else {
                console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
            }
        } else {
            inserted += data?.length || 0;
            console.log(`✓ Batch ${Math.floor(i / batchSize) + 1}: ${data?.length || 0} events inserted`);
        }
    }

    console.log(`\n✅ Migration complete:`);
    console.log(`   - Inserted: ${inserted} events`);
    console.log(`   - Skipped (duplicates): ${skipped} events`);

    // 4. Проверка
    const { count } = await supabase
        .from('raw_order_events')
        .select('*', { count: 'exact', head: true });

    console.log(`   - Total in raw_order_events: ${count} events\n`);
}

async function main() {
    try {
        await migrateOrdersToRawEvents();
        console.log('✅ Migration completed successfully\n');
    } catch (error: any) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();
