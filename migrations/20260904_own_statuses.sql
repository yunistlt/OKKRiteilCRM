-- Собственные статусы будущей внутренней CRM. Полностью в стороне от синка RetailCRM:
-- свои таблицы, свои идентификаторы, никакой зависимости от retailcrm_dictionaries.
-- Сопоставление с текущей CRM сделаем отдельно, когда будем переезжать; для этого у
-- каждой сущности есть поле external_code — метка «чему это соответствует у них».

CREATE TABLE IF NOT EXISTS public.crm_status_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color TEXT,
    ordering INT NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT true,
    external_code TEXT,                  -- код группы в RetailCRM, если сопоставлено
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    group_id UUID REFERENCES public.crm_status_groups(id) ON DELETE SET NULL,
    color TEXT,
    ordering INT NOT NULL DEFAULT 100,
    norm_days INT,                       -- сколько заказу позволено быть в этом статусе
    is_working BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    external_code TEXT,                  -- код статуса в RetailCRM, если сопоставлено
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Разрешённый переход: строка есть — переход разрешён.
CREATE TABLE IF NOT EXISTS public.crm_status_transitions (
    from_status_id UUID NOT NULL REFERENCES public.crm_statuses(id) ON DELETE CASCADE,
    to_status_id UUID NOT NULL REFERENCES public.crm_statuses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (from_status_id, to_status_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_statuses_group ON public.crm_statuses(group_id, ordering);
CREATE INDEX IF NOT EXISTS idx_crm_status_transitions_from ON public.crm_status_transitions(from_status_id);

ALTER TABLE public.crm_status_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_status_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.crm_status_groups;
CREATE POLICY "service role full access" ON public.crm_status_groups FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service role full access" ON public.crm_statuses;
CREATE POLICY "service role full access" ON public.crm_statuses FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service role full access" ON public.crm_status_transitions;
CREATE POLICY "service role full access" ON public.crm_status_transitions FOR ALL USING (true) WITH CHECK (true);

-- Черновик прошлого захода: он лез в синк RetailCRM, что оказалось неверным подходом.
DROP TABLE IF EXISTS public.status_overrides;
DROP TABLE IF EXISTS public.status_transitions;

COMMENT ON TABLE public.crm_status_groups IS 'Свои группы статусов (внутренняя CRM), независимо от RetailCRM';
COMMENT ON TABLE public.crm_statuses IS 'Свои статусы заказа: группа, порядок, цвет, норматив времени';
COMMENT ON TABLE public.crm_status_transitions IS 'Разрешённые переходы между своими статусами';
COMMENT ON COLUMN public.crm_statuses.external_code IS 'Метка соответствия статусу RetailCRM — для будущего перехода';
