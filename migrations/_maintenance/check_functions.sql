-- Проверка всех пользовательских функций в Supabase
SELECT 
    routine_name as function_name,
    routine_type as type,
    data_type as return_type,
    routine_definition as definition
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
