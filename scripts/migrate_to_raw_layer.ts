import { supabase } from '../utils/supabase';

/**
 * Миграция данных: order_history → raw_order_events
 * 
 * Преобразуем события изменений полей в структурированные события
 */

async function migrateOrderHistory() {
    console.log('=== MIGRATING order_history → raw_order_events ===\n');

    // 1. Получить все события из order_history
    const { data: historyEvents, error: fetchError } = await supabase
        .from('order_history')
        .select('*')
        .order('created_at', { ascending: true });

    if (fetchError) {
        console.error('❌ Error fetching order_history:', fetchError);
        return;
    }

    console.log(`📊 Found ${historyEvents?.length || 0} history events to migrate\n`);

    if (!historyEvents || historyEvents.length === 0) {
        console.log('✅ No data to migrate');
        return;
    }

    // 2. Преобразовать в формат raw_order_events
    const rawEvents = historyEvents.map(event => {
        // Определяем тип события по field_name
        let eventType = 'field_changed';
        if (event.field_name === 'status') {
            eventType = 'status_changed';
        } else if (event.field_name === 'comment') {
            eventType = 'comment_added';
        } else if (event.field_name === 'phone' || event.field_name === 'additional_phone') {
            eventType = 'phone_changed';
        } else if (event.field_name.includes('manager')) {
            eventType = 'manager_changed';
        }

        return {
            retailcrm_order_id: event.order_id,
            event_type: eventType,
            occurred_at: event.created_at,
            source: event.source || 'retailcrm',
            raw_payload: {
                field_name: event.field_name,
                old_value: event.old_value,
                new_value: event.new_value,
                manager_id: event.manager_id,
                original_event_id: event.id
            }
        };
    });

    // 3. Вставить батчами (по 1000 записей)
    const batchSize = 1000;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < rawEvents.length; i += batchSize) {
        const batch = rawEvents.slice(i, i + batchSize);

        const { data, error } = await supabase
            .from('raw_order_events')
            .insert(batch)
            .select();

        if (error) {
            // Проверяем, не дубликаты ли это
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

async function migrateTelphinCalls() {
    console.log('=== MIGRATING calls → raw_telphin_calls ===\n');

    // 1. Получить все звонки
    const { data: calls, error: fetchError } = await supabase
        .from('calls')
        .select('*')
        .order('timestamp', { ascending: true });

    if (fetchError) {
        console.error('❌ Error fetching calls:', fetchError);
        return;
    }

    console.log(`📊 Found ${calls?.length || 0} calls to migrate\n`);

    if (!calls || calls.length === 0) {
        console.log('✅ No data to migrate');
        return;
    }

    // 2. Функция нормализации номера
    const normalizePhone = (phone: string | null): string | null => {
        if (!phone) return null;
        return phone.replace(/[^\d+]/g, '');
    };

    // 3. Преобразовать в формат raw_telphin_calls
    const rawCalls = calls.map(call => ({
        telphin_call_id: call.id,
        direction: call.flow || 'outgoing',
        from_number: call.from_number || '',
        to_number: call.to_number || '',
        from_number_normalized: normalizePhone(call.from_number),
        to_number_normalized: normalizePhone(call.to_number),
        started_at: call.timestamp,
        duration_sec: call.duration || 0,
        recording_url: call.record_url,
        raw_payload: {
            original_call_id: call.id,
            transcript: call.transcript,
            is_answering_machine: call.is_answering_machine,
            am_detection_result: call.am_detection_result
        }
    }));

    // 4. Вставить батчами
    const batchSize = 500;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < rawCalls.length; i += batchSize) {
        const batch = rawCalls.slice(i, i + batchSize);

        const { data, error } = await supabase
            .from('raw_telphin_calls')
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
            console.log(`✓ Batch ${Math.floor(i / batchSize) + 1}: ${data?.length || 0} calls inserted`);
        }
    }

    console.log(`\n✅ Migration complete:`);
    console.log(`   - Inserted: ${inserted} calls`);
    console.log(`   - Skipped (duplicates): ${skipped} calls`);

    // 5. Проверка
    const { count } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true });

    console.log(`   - Total in raw_telphin_calls: ${count} calls\n`);
}

async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  RAW LAYER DATA MIGRATION              ║');
    console.log('╚════════════════════════════════════════╝\n');

    try {
        await migrateOrderHistory();
        await migrateTelphinCalls();

        console.log('╔════════════════════════════════════════╗');
        console.log('║  ✅ MIGRATION COMPLETED SUCCESSFULLY   ║');
        console.log('╚════════════════════════════════════════╝\n');
    } catch (error: any) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();
