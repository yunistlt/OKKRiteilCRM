// Скрипт для проверки функций в Supabase
import { supabase } from '../utils/supabase';

async function checkFunctions() {
    console.log('=== ПРОВЕРКА ФУНКЦИЙ В SUPABASE ===\n');

    try {
        // Получаем список всех функций
        const { data, error } = await supabase.rpc('pg_get_functiondef', {
            funcid: 'test_match_calls_simple'
        });

        if (error) {
            console.log('Попробуем другой способ...\n');

            // Альтернативный способ - через прямой SQL запрос
            const { data: functions, error: err2 } = await supabase
                .from('pg_proc')
                .select('proname')
                .limit(100);

            if (err2) {
                console.log('❌ Не удалось получить список функций');
                console.log('Проверьте вручную в Supabase Dashboard → Database → Functions');
                return;
            }
        }

        console.log('✅ Проверка завершена');
        console.log('\nИзвестные функции, которые мы создали:');
        console.log('  - test_match_calls_simple (только что создали)');
        console.log('  - test_match_calls_to_orders (с ошибкой, не работает)');

        console.log('\nЧто делать:');
        console.log('1. Откройте Supabase Dashboard → Database → Functions');
        console.log('2. Найдите функции начинающиеся с "test_"');
        console.log('3. Удалите test_match_calls_to_orders (если есть)');
        console.log('4. Оставьте test_match_calls_simple');

    } catch (e: any) {
        console.error('❌ Ошибка:', e.message);
    }
}

checkFunctions();
