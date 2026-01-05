
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function run() {
    console.log('--- 🚀 ЗАПУСК МИГРАЦИИ ТЕКСТОВ ---');

    // 1. Находим записи, где текст есть в пейлоаде (как строка), но нет в колонке
    const { data: records, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, raw_payload')
        .is('transcript', null)
        .not('raw_payload->>transcript', 'is', null);

    if (error) {
        console.error('Ошибка при поиске записей:', error);
        return;
    }

    if (!records || records.length === 0) {
        console.log('✅ Все тексты уже синхронизированы.');
        return;
    }

    console.log(`📦 Найдено ${records.length} записей для миграции...`);

    let successCount = 0;
    const CHUNK_SIZE = 100;

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const payload = r.raw_payload as any;

        const { error: updateErr } = await supabase
            .from('raw_telphin_calls')
            .update({
                transcript: payload.transcript,
                transcription_status: 'completed'
            })
            .eq('telphin_call_id', r.telphin_call_id);

        if (updateErr) {
            console.error(`❌ Ошибка на записи ${r.telphin_call_id}:`, updateErr);
        } else {
            successCount++;
            if (successCount % 50 === 0 || successCount === records.length) {
                process.stdout.write(`\r✅ Перенесено: ${successCount}/${records.length}`);
            }
        }
    }

    console.log('\n\n--- 🎉 МИГРАЦИЯ ЗАВЕРШЕНА ---');
}

run();
