// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Скрипт массовой синхронизации записей звонков в фоновом режиме.

import dotenv from 'dotenv';
import path from 'path';

// Загружаем локальные переменные окружения ДО импортов, которые могут использовать process.env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../utils/supabase';
import { syncRecordingToStorage } from '../lib/telphin-storage';

async function massSyncRecordings() {
    console.log('🚀 [СЕМЁН] Начинаю массовую синхронизацию звонков...');

    const LIMIT = 100; // Обрабатываем пачками по 100
    let offset = 0;
    let syncedCount = 0;
    let errorCount = 0;
    let alreadySyncedCount = 0;

    while (true) {
        console.log(`\n🔎 [СЕМЁН] Поиск звонков (пачка: ${offset} - ${offset + LIMIT})...`);

        // Ищем звонки, где storage_url еще не прописан в raw_payload
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('telphin_call_id, recording_url, raw_payload')
            .is('raw_payload->storage_url', null)
            .order('started_at', { ascending: false })
            .range(offset, offset + LIMIT - 1);

        if (error) {
            console.error('❌ [СЕМЁН] Ошибка БД при поиске звонков:', error);
            break;
        }

        if (!calls || calls.length === 0) {
            console.log('✅ [СЕМЁН] Все звонки синхронизированы!');
            break;
        }

        console.log(`📦 [СЕМЁН] Найдено ${calls.length} новых звонков для скачивания.`);

        for (const call of calls) {
            try {
                // Если recording_url пустой, пропускаем
                if (!call.recording_url) {
                    console.log(`⚠️ [СЕМЁН] Пропуск ${call.telphin_call_id}: нет ссылки на запись.`);
                    continue;
                }

                // Вызываем нашу функцию синхронизации
                const url = await syncRecordingToStorage(call.telphin_call_id, call.recording_url);

                if (url) {
                    console.log(`✅ [СЕМЁН] Синхронизировано: ${call.telphin_call_id}`);
                    syncedCount++;
                } else {
                    console.error(`❌ [СЕМЁН] Ошибка синхронизации ${call.telphin_call_id}`);
                    errorCount++;
                }

                // Небольшая задержка, чтобы не спамить API
                await new Promise(r => setTimeout(r, 500));

            } catch (e) {
                console.error(`❌ [СЕМЁН] Фатальная ошибка для ${call.telphin_call_id}:`, e);
                errorCount++;
            }
        }

        offset += LIMIT;
        // Если вернулось меньше чем лимит, значит это последняя пачка
        if (calls.length < LIMIT) break;
    }

    console.log('\n--- ИТОГО ---');
    console.log(`✅ Синхронизировано: ${syncedCount}`);
    console.log(`❌ Ошибок: ${errorCount}`);
    console.log(`🚀 [СЕМЁН] Миссия завершена.`);

    process.exit(0);
}

massSyncRecordings();
