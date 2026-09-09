-- Настройка статусов: группировка, порядок, цвет и правила переходов.
--
-- ВАЖНО: колонки statuses.ordering/group_name/color перезаписывает ночной синк из
-- RetailCRM, поэтому ручные правки туда класть нельзя — затрёт. Держим их отдельным
-- слоем поверх данных CRM: пусто = как в RetailCRM, заполнено = ваше решение.

CREATE TABLE IF NOT EXISTS public.status_overrides (
    code TEXT PRIMARY KEY,
    group_code TEXT,                     -- перенос статуса в другую группу
    ordering INT,                        -- свой порядок внутри группы
    color TEXT,                          -- свой цвет плашки
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Разрешённые переходы: строка есть — переход разрешён.
CREATE TABLE IF NOT EXISTS public.status_transitions (
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (from_code, to_code)
);

CREATE INDEX IF NOT EXISTS idx_status_transitions_from ON public.status_transitions(from_code);

ALTER TABLE public.status_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.status_overrides;
CREATE POLICY "service role full access" ON public.status_overrides FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service role full access" ON public.status_transitions;
CREATE POLICY "service role full access" ON public.status_transitions FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.status_overrides IS 'Ручные настройки статуса поверх данных RetailCRM: группа, порядок, цвет';
COMMENT ON TABLE public.status_transitions IS 'Разрешённые переходы между статусами: наличие строки = переход разрешён';
