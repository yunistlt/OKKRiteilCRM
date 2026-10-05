-- Роль «Логистика и закупки: только просмотр» (решение владельца 05.10.2026).
--
-- Наталья Дзордзи, кладовщик: видит то же, что Лариса и Катя, но ничего не
-- меняет. Отдельная роль, а не галочка у человека: права — свойство роли, и
-- так их видно в «Доступах и правах».
--
-- Роль заводится в трёх местах: тип app_role, ограничение users_role_check и код.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'app_role' AND e.enumlabel = 'logistics_view'
    ) THEN
        ALTER TYPE public.app_role ADD VALUE 'logistics_view';
    END IF;
END $$;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin', 'manager', 'okk', 'rop', 'jurist', 'demo', 'logistics', 'logistics_view']));
