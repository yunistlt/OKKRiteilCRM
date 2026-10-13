-- Перевод звонка по внутреннему номеру.
--
-- Решение владельца 05.10.2026: «если перевели звонок по внутреннему, то надо
-- показывать и тому, на кого перевели».
--
-- Телфин на перевод присылает новое событие с тем же идентификатором звонка, но
-- другим добавочным. Одно поле «добавочный» такое не переживает: оно
-- перезаписывается, и окно пропадает у первого, не успев появиться у второго.
-- Поэтому держим СПИСОК добавочных, которые участвовали в звонке, — окно видят
-- все они.
ALTER TABLE public.active_calls ADD COLUMN IF NOT EXISTS extensions text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.active_calls.extensions IS
    'Все добавочные, через которые прошёл звонок: кому звонили изначально и на кого перевели. Окно показываем каждому из них.';

-- Что уже лежит — переносим в список, чтобы старые записи не осиротели.
UPDATE public.active_calls
   SET extensions = ARRAY[extension_number]
 WHERE extension_number IS NOT NULL
   AND (extensions IS NULL OR cardinality(extensions) = 0);

CREATE INDEX IF NOT EXISTS idx_active_calls_extensions ON public.active_calls USING gin (extensions);
