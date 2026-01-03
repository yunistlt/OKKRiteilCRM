import { supabase } from '../utils/supabase';
import { normalizePhone } from '../lib/phone-utils';

/**
 * Правильная миграция calls → raw_telphin_calls
 * Извлекаем номера из raw_data JSON
 */

async function migrateTelphinCallsCorrect() {
    console.log('=== MIGRATING calls → raw_telphin_calls (CORRECT) ===\n');

    // 1. Очистить существующие данные
    console.log('Clearing existing raw_telphin_calls...');
    await supabase.from('raw_telphin_calls').delete().neq('event_id', 0);

    // 2. Получить все звонки
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

    // 3. Преобразовать в формат raw_telphin_calls
    const rawCalls = calls.map(call => {
        const rawData = call.raw_data as any || {};

        // Извлекаем номера из raw_data
        const fromNumber = rawData.from_username || rawData.ani_number || '';
        const toNumber = rawData.to_username || rawData.dest_number || '';

        // Определяем направление
        const direction = rawData.flow === 'in' ? 'incoming' : 'outgoing';

        return {
            telphin_call_id: call.id,
            direction,
            from_number: fromNumber,
            to_number: toNumber,
            from_number_normalized: normalizePhone(fromNumber),
            to_number_normalized: normalizePhone(toNumber),
            started_at: call.timestamp,
            duration_sec: call.duration || 0,
            recording_url: call.record_url,
            raw_payload: {
                original_call_id: call.id,
                transcript: call.transcript,
                is_answering_machine: call.is_answering_machine,
                am_detection_result: call.am_detection_result,
                raw_data: rawData
            }
        };
    });

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

    // 6. Показать примеры
    const { data: samples } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .not('from_number_normalized', 'is', null)
        .limit(5);

    console.log('Sample migrated calls:');
    samples?.forEach(s => {
        console.log(`  ${s.telphin_call_id}:`);
        console.log(`    from: ${s.from_number} -> ${s.from_number_normalized}`);
        console.log(`    to: ${s.to_number} -> ${s.to_number_normalized}`);
        console.log(`    direction: ${s.direction}`);
    });
}

async function main() {
    try {
        await migrateTelphinCallsCorrect();
        console.log('\n✅ Migration completed successfully\n');
    } catch (error: any) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();
