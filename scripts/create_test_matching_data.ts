import { supabase } from '../utils/supabase';
import { normalizePhone } from '../lib/phone-utils';

/**
 * Создаём тестовые данные для проверки матчинга
 * Берём существующие заказы и создаём для них звонки
 */

async function createTestMatchingData() {
    console.log('=== CREATING TEST MATCHING DATA ===\n');

    // 1. Берём 20 заказов с телефонами
    const { data: orderEvents } = await supabase
        .from('raw_order_events')
        .select('retailcrm_order_id, phone, phone_normalized, occurred_at')
        .not('phone_normalized', 'is', null)
        .neq('phone_normalized', '')
        .order('occurred_at', { ascending: false })
        .limit(20);

    if (!orderEvents || orderEvents.length === 0) {
        console.log('❌ No orders with phones found');
        return;
    }

    console.log(`Found ${orderEvents.length} orders with phones\n`);

    // 2. Создаём синтетические звонки для этих заказов
    const testCalls = orderEvents.map((order, index) => {
        // Время звонка: через 2-10 минут после события в заказе
        const eventTime = new Date(order.occurred_at);
        const callTime = new Date(eventTime.getTime() + (2 + index % 8) * 60 * 1000);

        return {
            telphin_call_id: `TEST-CALL-${Date.now()}-${index}`,
            direction: 'incoming',
            from_number: order.phone,
            to_number: '12037*120', // Внутренний номер компании
            from_number_normalized: order.phone_normalized,
            to_number_normalized: '12037120',
            started_at: callTime.toISOString(),
            duration_sec: 30 + index * 5,
            recording_url: null,
            raw_payload: {
                test_data: true,
                original_order_id: order.retailcrm_order_id,
                created_for_matching_test: true
            }
        };
    });

    // 3. Вставляем тестовые звонки
    const { data: inserted, error } = await supabase
        .from('raw_telphin_calls')
        .insert(testCalls)
        .select();

    if (error) {
        console.error('❌ Error inserting test calls:', error);
        return;
    }

    console.log(`✅ Created ${inserted?.length || 0} test calls\n`);

    // 4. Показываем примеры
    console.log('Sample test calls:');
    inserted?.slice(0, 5).forEach((call, i) => {
        const order = orderEvents[i];
        console.log(`  ${i + 1}. Call ${call.telphin_call_id}`);
        console.log(`     Phone: ${call.from_number_normalized}`);
        console.log(`     Should match Order #${order.retailcrm_order_id}`);
        console.log(`     Time diff: ~${2 + i % 8} minutes`);
    });

    return inserted?.length || 0;
}

async function main() {
    try {
        const created = await createTestMatchingData();
        console.log(`\n✅ Test data created: ${created} calls\n`);
        console.log('Now run: curl "http://localhost:3000/api/matching/process?limit=100"');
    } catch (error: any) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();
