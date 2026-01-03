-- 1. Список всех таблиц и их колонок
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 2. Проверка, есть ли таблица в кэше PostgREST (косвенно, через права)
SELECT * FROM pg_tables WHERE schemaname = 'public';

-- 3. Проверка RLS Политик (может они скрывают доступ?)
SELECT schemaname, tablename, policyname, cmd, roles 
FROM pg_policies 
WHERE schemaname = 'public';

-- 4. Перезагрузка Кэша (на всякий случай еще раз)
NOTIFY pgrst, 'reload config';
