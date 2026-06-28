-- Четвёртый флаг статуса: «учитывать в нагрузке менеджера».
-- Управляется на странице «Статусы Заказов». Используется секретарём (Катериной) при назначении
-- новой заявки по нагрузке. Заменяет прежний список email_intake_config.load_exclude_status_codes.

ALTER TABLE public.status_settings
    ADD COLUMN IF NOT EXISTS is_manager_load BOOLEAN NOT NULL DEFAULT false;

-- Начальное состояние = прежняя логика: рабочие статусы (is_working) минус тендерные/отмена,
-- по которым менеджер активности не ведёт.
UPDATE public.status_settings
SET is_manager_load = true
WHERE is_working = true
  AND code <> ALL (ARRAY['soglasovanie-otmeny', 'tender', 'dubl-na-tender', 'ozhidanie-vykhoda-tendera']);
