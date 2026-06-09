-- ============================================================================
-- Планы продаж по месяцам. manager_id NULL = общий план отдела, иначе личный.
-- Метрика по умолчанию — выручка без НДС. Личные и общий план независимы.
-- План помесячный (не date-range): ключ — (год, месяц, менеджер, метрика).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.salary_plan (
    id          BIGSERIAL PRIMARY KEY,
    year        INT NOT NULL,
    month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    manager_id  BIGINT REFERENCES public.managers(id) ON DELETE CASCADE, -- NULL = отдел
    metric      TEXT NOT NULL DEFAULT 'revenue_no_vat',
    target      NUMERIC(14,2) NOT NULL,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один личный план на (менеджер, метрика, месяц)
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_plan_mgr
    ON public.salary_plan (year, month, manager_id, metric) WHERE manager_id IS NOT NULL;
-- Один общий план отдела на (метрика, месяц)
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_plan_dept
    ON public.salary_plan (year, month, metric) WHERE manager_id IS NULL;
