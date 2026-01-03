import { createClient } from '@supabase/supabase-js';
import { getTelphinToken } from './lib/telphin';
import { processCallTranscription } from './lib/transcription';

const supabaseUrl = 'https://lywtzgntmibdpgoijbty.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5d3R6Z250bWliZHBnb2lqYnR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzAzMzE4NSwiZXhwIjoyMDgyNjA5MTg1fQ.9jHVzGXQ8Rd2e4Bpe7tcWtq-hUCMvV9QaQSVsVZmPZw';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- 🚀 Запуск обработки необработанных звонков ---\n');
    let totalProcessed = 0;
    const BATCH_SIZE = 30;

    while (true) {
        try {
            // 1. Получить контролируемых менеджеров
            const { data: controlledManagers } = await supabase
                .from('manager_settings')
                .select('id')
                .eq('is_controlled', true);

            const controlledIds = (controlledManagers || []).map(m => m.id.toString());

            if (controlledIds.length === 0) {
                console.log('❌ Нет контролируемых менеджеров в настройках.');
                break;
            }

            // 2. Найти необработанные звонки
            const { data: calls } = await supabase
                .from('calls')
                .select(`
                    id, 
                    record_url, 
                    duration,
                    matches!inner (
                        orders!inner (
                            manager_id
                        )
                    )
                `)
                .is('transcript', null)
                .not('record_url', 'is', null)
                .in('matches.orders.manager_id', controlledIds)
                .order('timestamp', { ascending: false })
                .limit(BATCH_SIZE);

            if (!calls || calls.length === 0) {
                console.log('\n✅ Все звонки обработаны!');
                break;
            }

            console.log(`📦 Найдено ${calls.length} звонков для обработки...`);

            // 3. Получить токен Telphin
            const token = await getTelphinToken();

            // 4. Обработать пакет
            let batchSuccess = 0;
            for (const call of calls) {
                try {
                    const result = await processCallTranscription(call.id, call.record_url!, token);
                    if (result.success) {
                        batchSuccess++;
                        totalProcessed++;
                        process.stdout.write(`\r✅ Обработано: ${totalProcessed} (текущий пакет: ${batchSuccess}/${calls.length})`);
                    }
                } catch (e: any) {
                    console.error(`\n❌ Ошибка обработки ${call.id}:`, e.message);
                }
            }

            console.log(`\n📊 Пакет завершен: ${batchSuccess}/${calls.length} успешно\n`);

            // Небольшая пауза между пакетами
            await new Promise(r => setTimeout(r, 2000));

        } catch (e: any) {
            console.error('❌ Ошибка в цикле обработки:', e.message);
            break;
        }
    }

    console.log(`\n--- 🎉 Обработка завершена. Всего обработано: ${totalProcessed} звонков ---\n`);
}

run().catch(console.error);
