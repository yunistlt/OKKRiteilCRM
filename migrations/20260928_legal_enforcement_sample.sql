-- Пометка «образец/тест» у карточки исполнительного производства.
--
-- Тестовые прогоны неотличимы от настоящих: те же поля, та же сумма долга. В
-- разделе, где числа идут в ФД-отчёт, это прямой путь к вранью в отчёте.
-- Помеченные карточки видны, но подписаны и не попадают в суммы.
ALTER TABLE public.legal_enforcement_cases
    ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_legal_enf_is_sample ON public.legal_enforcement_cases (is_sample);
