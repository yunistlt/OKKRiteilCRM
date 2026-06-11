-- ============================================================================
-- Членство в ЗП (кому пофамильно начислять) — настраивается в /settings/managers.
-- Отдельная таблица, чтобы не пересекаться с manager_settings.is_controlled
-- (это про анализ нарушений, другое). Роль (схему) определяют группы RetailCRM
-- (salary_role_map), а ВКЛЮЧЕНИЕ в расчёт — этот флаг. В реестр ЗП попадает
-- менеджер, который И отмечен здесь, И имеет разрешённую роль из групп.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.salary_participant (
    manager_id BIGINT PRIMARY KEY REFERENCES public.managers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT
);

-- Сид: текущие оплачиваемые (из salary_manager_comp), чтобы реестр не обнулился.
INSERT INTO public.salary_participant (manager_id, created_by)
SELECT DISTINCT manager_id, 'migration'
FROM public.salary_manager_comp
ON CONFLICT (manager_id) DO NOTHING;
