-- Роль «Юрист» в перечислении ролей базы.
--
-- Роль живёт в двух местах: тип AppRole в коде и enum app_role в Postgres.
-- Без этой строки любая попытка сохранить пользователя или приглашение с ролью
-- jurist падает «invalid input value for enum app_role».
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'jurist';
