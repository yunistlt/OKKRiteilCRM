// Скрипт для листинга всех функций в Supabase
import { supabase } from '../utils/supabase';

async function listFunctions() {
    console.log('=== СПИСОК ФУНКЦИЙ В SUPABASE ===\n');

    try {
        // Мы не можем напрямую селектить из pg_proc через Supabase client обычно
        // Но мы можем попробовать вызвать системную функцию или сделать запрос к information_schema если разрешено
        const { data, error } = await supabase
            .from('pg_proc')
            .select('proname')
            .limit(10); // Это скорее всего упадет из-за прав

        if (error) {
            console.log('Попытка 2: вызвать системную информацию через RPC...');
            // Если у нас нет специального RPC для этого, мы пойдем другим путем
            console.log('RPC не сработал. Давайте попробуем просто вызвать нашу функцию.');
        } else {
            console.log('Функции:', data.map(f => f.proname).join(', '));
        }

        console.log('\nПробуем вызвать match_calls_to_orders(1)...');
        const { data: res, error: callError } = await supabase.rpc('match_calls_to_orders', {
            batch_limit: 1
        });

        if (callError) {
            console.error('❌ Ошибка вызова:', callError.message);
            if (callError.message.includes('does not exist')) {
                console.log('⚠️ ФУНКЦИЯ ДЕЙСТВИТЕЛЬНО НЕ СУЩЕСТВУЕТ!');
            }
        } else {
            console.log('✅ ФУНКЦИЯ РАБОТАЕТ!');
            console.log('Результат:', res);
        }

    } catch (e: any) {
        console.error('❌ Ошибка:', e.message);
    }
}

listFunctions();
