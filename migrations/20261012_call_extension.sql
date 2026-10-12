-- Чей добавочный в звонке — отдельной колонкой.
--
-- Разбор ног разговора лежит в `raw_payload`: у входящего из очереди их
-- девять, и в сумме это мегабайты. Список звонков тянул их целиком и собирался
-- 7,5 секунды на двести строк — экран «Загружаю…» висел, пока менеджер ждал.
-- Считаем добавочный один раз при приёме звонка и пишем сюда.
--
-- Миграция добавочная: старые строки заполняются скриптом
-- `scripts/backfill-call-extension.ts`.

ALTER TABLE public.raw_telphin_calls
    ADD COLUMN IF NOT EXISTS manager_extension TEXT;

COMMENT ON COLUMN public.raw_telphin_calls.manager_extension IS
    'Добавочный сотрудника, который говорил (входящий — кто взял трубку, исходящий — с чьего телефона звонили).';

CREATE INDEX IF NOT EXISTS raw_telphin_calls_extension_idx
    ON public.raw_telphin_calls (manager_extension)
    WHERE manager_extension IS NOT NULL;
