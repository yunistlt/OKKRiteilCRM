// Скрипт для проверки фильтра транскрибации по статусам
import { supabase } from '../utils/supabase';

async function verifyTranscriptionFilter() {
    console.log('=== ПРОВЕРКА ФИЛЬТРА ТРАНСКРИБАЦИИ ===\n');

    try {
        // 1. Получаем список транскрибируемых статусов
        const { data: statusSettings } = await supabase
            .from('status_settings')
            .select('code')
            .eq('is_transcribable', true);

        const transcribableStatuses = statusSettings?.map(s => s.code) || [];
        console.log('Разрешенные статусы:', transcribableStatuses.join(', '));

        if (transcribableStatuses.length === 0) {
            console.log('❌ Нет статусов для транскрибации.');
            return;
        }

        // 2. Пробуем найти звонки по фильтру
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        console.log('\nВыполняем запрос к БД...');
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select(`
                event_id,
                started_at,
                transcription_status,
                matches:call_order_matches!inner(
                    retailcrm_order_id,
                    orders:orders!inner(status)
                )
            `)
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .in('matches.orders.status', transcribableStatuses)
            .limit(5);

        if (error) {
            console.error('❌ Ошибка запроса:', error.message);
            console.error('Детали:', error.details);
            console.error('Подсказка:', error.hint);
            return;
        }

        console.log(`✅ Найдено звонков для транскрибации: ${calls?.length || 0}`);

        if (calls && calls.length > 0) {
            calls.forEach(c => {
                // @ts-ignore
                const status = c.matches[0]?.orders?.status;
                console.log(`- Звонок ${c.event_id} (Заказ ${c.matches[0]?.retailcrm_order_id}, Статус: ${status})`);
            });
        }

    } catch (e: any) {
        console.error('❌ Критическая ошибка:', e.message);
    }
}

verifyTranscriptionFilter();
