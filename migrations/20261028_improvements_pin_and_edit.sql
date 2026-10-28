-- Реестр доработок: закреп записи наверху и правка своей записи.
--
-- Лена Парфёнова 21.10.2026 (доработка №31): «Можно тут сделать закреп записи?
-- Нужно чтобы запись главная была вверху и её мог закреплять или откреплять,
-- переписывать менеджер».
--
-- Закреплённые показываются первыми, открепление возвращает запись в общий
-- порядок. Правка — только своей и только пока доработка не закрыта; когда
-- правили, видно в реестре, чтобы нельзя было молча переписать просьбу.
ALTER TABLE public.improvements
    ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
    ADD COLUMN IF NOT EXISTS pinned_by text,
    ADD COLUMN IF NOT EXISTS edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS edited_by text;

-- Закреплённых единицы, а читается реестр каждым заходом на страницу.
CREATE INDEX IF NOT EXISTS improvements_pinned_idx
    ON public.improvements (pinned_at DESC)
    WHERE pinned_at IS NOT NULL;
