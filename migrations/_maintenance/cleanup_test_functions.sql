-- Удаление тестовых функций (если они есть)
DROP FUNCTION IF EXISTS test_match_calls_to_orders(INT);
DROP FUNCTION IF EXISTS test_match_calls_simple(INT);

-- Проверка оставшихся функций
SELECT routine_name 
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%match%'
ORDER BY routine_name;
