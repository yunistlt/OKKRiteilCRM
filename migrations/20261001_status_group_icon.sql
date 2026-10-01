-- Иконка этапа статусов.
--
-- В RetailCRM у каждого этапа своя иконка, и менеджеры узнают этап по ней
-- быстрее, чем по тексту. По API они её не отдают (в reference/status-groups
-- только name, code, active, ordering, process, statuses — проверено
-- 01.10.2026), поэтому иконку держим у себя и выбираем руками в настройке
-- этапа: это оформление, а не данные RetailCRM.
--
-- Значение — короткий код из нашего набора (lamp, chat, person, tender...),
-- чтобы интерфейс не зависел от названия библиотеки иконок.

ALTER TABLE public.crm_status_groups
    ADD COLUMN IF NOT EXISTS icon TEXT;

COMMENT ON COLUMN public.crm_status_groups.icon IS
  'Код иконки этапа из нашего набора; пусто — показываем кружок цвета этапа';
