-- ЗАКОН владельца 12.10.2026: файлы не удаляются никогда, их можно только
-- пометить архивными.
--
-- До этого кнопка «убрать файл» ставила deleted_at И стирала сам файл из
-- хранилища — вернуть его было уже нельзя. Теперь пользовательское действие
-- только помечает строку архивной, а бинарь остаётся на месте.
--
-- Проверено перед созданием (закон «проверь, что такого ещё нет»): колонок
-- archived_at / archived_by в order_files нет.

ALTER TABLE public.order_files
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by text;

COMMENT ON COLUMN public.order_files.archived_at IS
    'Файл убран из рабочего списка заказа. Сам файл остаётся: удалять файлы запрещено (закон 12.10.2026)';
COMMENT ON COLUMN public.order_files.archived_by IS
    'Кто отправил файл в архив';

-- Прежние «удалённые» строки — это тот же архив. Переносим отметку, чтобы в
-- списках они вели себя одинаково.
UPDATE public.order_files
   SET archived_at = deleted_at
 WHERE deleted_at IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN public.order_files.deleted_at IS
    'Историческая колонка: новые записи сюда не пишутся, пользуйтесь archived_at';

CREATE INDEX IF NOT EXISTS order_files_archive_idx
    ON public.order_files (order_number)
    WHERE archived_at IS NULL AND deleted_at IS NULL;
