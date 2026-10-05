-- Роль «Логистика и закупки» (решение владельца 05.10.2026).
--
-- Лариса Хоменко и Катя Симонова ведут отгрузку, доставку и закупки: им нужны
-- заказы, клиенты, письма и звонки, но не нужны зарплата и мотивация. До этого
-- они сидели под ролью менеджера и видели зарплатные разделы.
--
-- Роль заводится в ТРЁХ местах, иначе вход ломается: тип app_role, ограничение
-- users_role_check и код (lib/auth.ts, lib/rbac.ts).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'app_role' AND e.enumlabel = 'logistics'
    ) THEN
        ALTER TYPE public.app_role ADD VALUE 'logistics';
    END IF;
END $$;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin', 'manager', 'okk', 'rop', 'jurist', 'demo', 'logistics']));
