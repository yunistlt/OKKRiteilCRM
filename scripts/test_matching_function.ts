// Скрипт для тестирования SQL функции матчинга
import { supabase } from '../utils/supabase';

async function testMatchingFunction() {
    console.log('=== ТЕСТ SQL ФУНКЦИИ МАТЧИНГА ===\n');

    try {
        // 1. Вызываем тестовую функцию
        console.log('1. Вызываем test_match_calls_to_orders(50)...');
        const startTime = Date.now();

        const { data, error } = await supabase.rpc('test_match_calls_to_orders', {
            batch_limit: 50
        });

        const elapsed = Date.now() - startTime;

        if (error) {
            console.error('❌ Ошибка:', error);
            return;
        }

        console.log(`✅ Выполнено за ${elapsed}ms\n`);

        // 2. Анализируем результаты
        console.log('2. РЕЗУЛЬТАТЫ:');
        console.log(`   Найдено матчей: ${data?.length || 0}`);

        if (data && data.length > 0) {
            // Группируем по типу матча
            const byType: Record<string, number> = {};
            data.forEach((match: any) => {
                byType[match.match_type] = (byType[match.match_type] || 0) + 1;
            });

            console.log('\n   По типам:');
            Object.entries(byType).forEach(([type, count]) => {
                console.log(`     - ${type}: ${count}`);
            });

            // Средний confidence
            const avgConfidence = data.reduce((sum: number, m: any) => sum + parseFloat(m.confidence_score), 0) / data.length;
            console.log(`\n   Средний confidence: ${avgConfidence.toFixed(2)}`);

            // Примеры
            console.log('\n3. ПРИМЕРЫ МАТЧЕЙ:');
            data.slice(0, 5).forEach((match: any, i: number) => {
                console.log(`\n   Матч ${i + 1}:`);
                console.log(`     Звонок: ${match.telphin_call_id}`);
                console.log(`     Заказ: ${match.retailcrm_order_id}`);
                console.log(`     Тип: ${match.match_type}`);
                console.log(`     Confidence: ${match.confidence_score}`);
                console.log(`     Объяснение: ${match.explanation}`);
            });
        }

        // 3. Сравнение с текущим подходом
        console.log('\n4. СРАВНЕНИЕ:');
        console.log(`   SQL функция: ${elapsed}ms`);
        console.log(`   Node.js подход: ~30000-60000ms (оценка)`);
        console.log(`   Ускорение: ~${Math.round(30000 / elapsed)}x`);

    } catch (e: any) {
        console.error('❌ Ошибка выполнения:', e.message);
    }
}

testMatchingFunction();
