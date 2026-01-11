// Скрипт для финальной проверки системы матчинга
import { supabase } from '../utils/supabase';
import { processUnmatchedCalls } from '../lib/call-matching';

async function verifyProductionMatching() {
    console.log('=== ФИНАЛЬНАЯ ПРОВЕРКА МАТЧИНГА ===\n');

    try {
        // 1. Проверяем наличие функции в Supabase
        console.log('1. Проверка функции match_calls_to_orders...');
        const { data: funcCheck, error: funcError } = await supabase
            .from('pg_proc')
            .select('proname')
            .eq('proname', 'match_calls_to_orders')
            .maybeSingle();

        if (funcError || !funcCheck) {
            console.error('❌ Функция match_calls_to_orders не найдена!');
            return;
        }
        console.log('✅ Функция найдена в БД.\n');

        // 2. Запускаем матчинг через код приложения
        console.log('2. Запуск processUnmatchedCalls(50)...');
        const startTime = Date.now();

        const matchesFound = await processUnmatchedCalls(50);

        const elapsed = Date.now() - startTime;
        console.log(`\n✅ Завершено за ${elapsed}ms`);
        console.log(`💎 Найдено и сохранено матчей: ${matchesFound}`);

        // 3. Проверяем сохранение в таблицу
        console.log('\n3. Проверка сохраненных матчей в таблице call_order_matches...');
        const { count, error: countError } = await supabase
            .from('call_order_matches')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            console.error('❌ Ошибка при проверке таблицы:', countError.message);
        } else {
            console.log(`📊 Всего матчей в системе: ${count}`);
        }

    } catch (e: any) {
        console.error('❌ Критическая ошибка:', e.message);
    }
}

verifyProductionMatching();
