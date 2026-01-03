-- 1. Выдать права на таблицу orders
GRANT ALL ON TABLE orders TO anon, authenticated, service_role;

-- 2. Отключить RLS
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;

-- 3. Обновить кэш
NOTIFY pgrst, 'reload config';
