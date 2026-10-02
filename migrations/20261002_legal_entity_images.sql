-- Картинки печати и подписи по каждому юрлицу.
--
-- Решение владельца 02.10.2026: рисованная печать получилась плохо, надо
-- ставить настоящие — те, что стоят на счетах из RetailCRM, плюс его подпись.
-- Файлы кладём в существующий бакет okk-assets, здесь только путь.
--
-- Проверено перед добавлением: таких колонок в legal_entities нет, отдельной
-- таблицы под файлы юрлиц тоже нет.

ALTER TABLE public.legal_entities
    ADD COLUMN IF NOT EXISTS seal_image_path text,
    ADD COLUMN IF NOT EXISTS signature_image_path text;

COMMENT ON COLUMN public.legal_entities.seal_image_path IS
    'Путь в бакете okk-assets до картинки печати. Пусто — печать рисуется по реквизитам, а у ИП не ставится вовсе.';
COMMENT ON COLUMN public.legal_entities.signature_image_path IS
    'Путь в бакете okk-assets до картинки подписи руководителя.';
