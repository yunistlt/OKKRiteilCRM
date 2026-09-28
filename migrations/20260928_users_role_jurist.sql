-- Роль «Юрист» в ограничении локальных аккаунтов.
--
-- Роль живёт в ТРЁХ местах: тип AppRole в коде, enum app_role (таблица profiles)
-- и текстовый CHECK на таблице users (локальные аккаунты по логину). Без третьего
-- регистрация по приглашению падает: new row for relation "users" violates check
-- constraint "users_role_check".
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'okk'::text, 'rop'::text, 'jurist'::text, 'demo'::text]));
