-- ============================================================================
-- Роль (схема ЗП) менеджера определяется ГРУППАМИ пользователя в RetailCRM,
-- а не назначается вручную. salary_role_map: группа RetailCRM → схема ЗП.
-- Резолв (lib/salary/roles.ts):
--   0 подходящих групп → не в реестре;
--   1 кандидат        → авто-назначение;
--   2+ кандидата       → выбор пользователя в ОКК (из этих ролей), хранится в salary_manager_comp.
-- Маппинг настраивается в UI; здесь — стартовый сид (подтверждён бизнесом).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.salary_role_map (
    retailcrm_group_code TEXT PRIMARY KEY,  -- код группы пользователя RetailCRM (raw_data.groups[].code)
    scheme_code          TEXT NOT NULL,     -- код схемы ЗП (salary_scheme.code)
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           TEXT
);

INSERT INTO public.salary_role_map (retailcrm_group_code, scheme_code, created_by) VALUES
    ('menedzhery',  'seller',   'system'),   -- Менеджеры ОП (rop…)
    ('menedzhery2', 'seller',   'system'),   -- Менеджеры ОП (zvto…)
    ('zmksoft',     'seller',   'system'),   -- Менеджеры ОП для ЦЕХ УСПЕХ
    ('kollczentr',  'operator', 'system')    -- Коллцентр
ON CONFLICT (retailcrm_group_code) DO NOTHING;
