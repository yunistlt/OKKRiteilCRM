-- Вкладка «Для производства» в карточке заказа (решение владельца 04.10.2026).
--
-- Зачем: раньше в ЦехУспех уезжал комментарий менеджера целиком, а там бывает внутренняя кухня —
-- договорённости по цене, переписка про согласование. Цеху это ни к чему, а иногда и вредно.
-- Теперь менеджер сам пишет, что передать в производство, и отмечает файлы (ТЗ заказчика),
-- которые должны уехать вместе с заказом.
--
-- Файлы НЕ дублируем: они уже лежат в order_files (туда же импортируются вложения из RetailCRM).
-- Достаточно отметки «этот файл — для цеха».

CREATE TABLE IF NOT EXISTS public.tseh_production_notes (
    -- Номер заказа ОКК — тот же ключ связи, что в очереди tseh_production_outbox.
    order_number text PRIMARY KEY,
    -- Что менеджер хочет сказать производству. Именно это уходит в комментарий заказа ЦехУспеха.
    comment      text,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tseh_production_notes IS
    'Комментарий менеджера ДЛЯ ПРОИЗВОДСТВА: только он уходит в ЦехУспех, а не вся переписка по заказу';

-- Отметка «передать этот файл в производство». Аддитивно: существующие строки получают false,
-- то есть без явной отметки в цех не уходит ничего.
ALTER TABLE public.order_files
    ADD COLUMN IF NOT EXISTS for_production boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_files.for_production IS
    'Файл отмечен менеджером как передаваемый в производство (ТЗ заказчика и т.п.)';

CREATE INDEX IF NOT EXISTS idx_order_files_for_production
    ON public.order_files (order_number)
    WHERE for_production AND deleted_at IS NULL;
