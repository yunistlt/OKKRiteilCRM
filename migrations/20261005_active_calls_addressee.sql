-- Кому показывать окно звонка.
--
-- Решение владельца 05.10.2026: окно видит тот, на чей добавочный идёт звонок;
-- руководитель и ОКК видят все; звонок на очередь (у вас «200 · Менеджеры ОП»,
-- «003 · Новая») звонит у нескольких сразу — его видят все, кто в очереди.
--
-- Телфин присылает добавочный полным именем вида «12037*120@corp.telphin.ru».
-- Для сравнения с карточкой менеджера (там просто «120») нужен короткий номер.
ALTER TABLE public.active_calls ADD COLUMN IF NOT EXISTS extension_number text;
ALTER TABLE public.active_calls ADD COLUMN IF NOT EXISTS is_queue boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.active_calls.extension_number IS
    'Короткий номер добавочного, на который идёт звонок («120»). По нему окно адресуется хозяину телефона.';
COMMENT ON COLUMN public.active_calls.is_queue IS
    'Звонок на очередь, а не на личный добавочный: телефон звонит у нескольких, окно показываем всем.';

CREATE INDEX IF NOT EXISTS idx_active_calls_extension ON public.active_calls (extension_number) WHERE extension_number IS NOT NULL;
