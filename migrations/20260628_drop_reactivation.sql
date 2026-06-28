-- Вывод из эксплуатации подсистемы «Реактивация» (агент «Виктория»).
-- Функция перенесена в другой проект; код подсистемы удалён.
-- Удаляем таблицы кампаний/логов рассылки и осиротевшую капабилити-колонку.

DROP TABLE IF EXISTS public.ai_outreach_logs CASCADE;
DROP TABLE IF EXISTS public.ai_reactivation_campaigns CASCADE;

ALTER TABLE IF EXISTS public.access_role_capabilities
    DROP COLUMN IF EXISTS can_view_reactivation;
