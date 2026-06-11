-- ============================================================================
-- Архивация ролей (схем) ЗП. Если по роли уже считалась зарплата за прошлые
-- периоды (есть строки в salary_calc с breakdown->>'schemeCode' = code), роль
-- НЕ удаляется, а архивируется: прячется из активного конструктора, но все её
-- версии и блоки сохраняются — историю расчётов (и пересчёт прошлых месяцев)
-- ничего не ломает. Архивную роль можно восстановить (archived_at = NULL).
-- Архивация code-level: проставляется на ВСЕ версии данного code.
-- Аддитивно и обратносовместимо: NULL = активна (как было до миграции).
-- ============================================================================

ALTER TABLE public.salary_scheme
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE INDEX IF NOT EXISTS idx_salary_scheme_archived ON public.salary_scheme (archived_at);
