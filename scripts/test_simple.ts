// Простой тест SQL функции
import { supabase } from '../utils/supabase';

async function testSimple() {
    console.log('=== ПРОСТОЙ ТЕСТ SQL ФУНКЦИИ ===\n');

    try {
        console.log('Вызываем test_match_calls_simple()...');

        const { data, error } = await supabase.rpc('test_match_calls_simple', {
            batch_limit: 50
        });

        if (error) {
            console.error('❌ Ошибка:', error.message);
            console.log('\n⚠️  Функция еще не создана в Supabase!');
            console.log('Выполните SQL из файла: migrations/20260111_test_simple.sql');
            return;
        }

        console.log('✅ Функция работает!');
        console.log('Результат:', data);

    } catch (e: any) {
        console.error('❌ Ошибка:', e.message);
    }
}

testSimple();
