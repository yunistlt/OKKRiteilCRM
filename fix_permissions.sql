-- 1. Выдать права
GRANT ALL ON TABLE managers TO anon, authenticated, service_role;

-- 2. Отключить RLS (чтобы не путался под ногами)
ALTER TABLE managers DISABLE ROW LEVEL SECURITY;

-- 3. Пнуть кэш (контрольный)
NOTIFY pgrst, 'reload config';
