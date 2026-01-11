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

        // 2. Статистика очереди
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Всего ПЕНДИНГ звонков с записью за 30 дней
        const { count: totalPending } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString());

        console.log(`Всего в очереди (с записями, <30д): ${totalPending}`);

        // 3. Выполняем запрос с учетом ТИПА СТАТУСА
        console.log('Выполняем запрос с учетом ваших галочек...');
        const { data: filteredCalls, error, count: activeQueue } = await supabase
            .from('raw_telphin_calls')
            .select(`
                event_id,
                matches:call_order_matches!inner(
                    orders:orders!inner(status)
                )
            `, { count: 'exact' })
            .eq('transcription_status', 'pending')
            .not('recording_url', 'is', null)
            .gte('started_at', thirtyDaysAgo.toISOString())
            .in('matches.orders.status', transcribableStatuses);

        if (error) {
            console.error('❌ Ошибка запроса:', error.message);
            return;
        }

        console.log(`✅ Активная очередь (только выбранные статусы): ${activeQueue}`);
        const skipped = (totalPending || 0) - (activeQueue || 0);
        console.log(`💡 Экономия: Пропущено ${skipped} звонков, которые не в тех статусах.`);

        if (filteredCalls && filteredCalls.length > 0) {
            console.log('\nПримеры звонков в работе:');
            filteredCalls.slice(0, 5).forEach(c => {
                // @ts-ignore
                const status = c.matches[0]?.orders?.status;
                console.log(`- Звонок ${c.event_id} -> Статус: ${status}`);
            });
        }

    } catch (e: any) {
        console.error('❌ Критическая ошибка:', e.message);
    }
}

verifyTranscriptionFilter();
