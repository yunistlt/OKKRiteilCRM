-- ============================================================================
-- Зарплатный модуль ОП (Фаза 1): схема данных + сид стартового конфига.
-- Принцип: НОЛЬ ХАРДКОДА. Все ставки/пороги/тиры/определения — в salary_config,
-- effective-dated, редактируются в админке (admin/rop). См. docs/salary/PLAN.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. КОНФИГ: effective-dated key/JSONB. Одна версия параметра на дату начала.
--    Расчёт за период берёт последнюю версию ключа с effective_from <= начало периода.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_config (
    id              BIGSERIAL PRIMARY KEY,
    key             TEXT NOT NULL,              -- oklad, rate_zayavka, k_quality_tiers, ...
    value           JSONB NOT NULL,             -- скаляр / map / массив тиров — форма по ключу
    effective_from  DATE NOT NULL,              -- с какой даты значение действует
    note            TEXT,                       -- комментарий к изменению
    created_by      TEXT,                       -- email редактора
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (key, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_salary_config_key_date
    ON public.salary_config (key, effective_from DESC);

-- ----------------------------------------------------------------------------
-- 2. ПЕРИОД: расчётный месяц и его статус.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_period (
    id              BIGSERIAL PRIMARY KEY,
    year            INT NOT NULL,
    month           INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_at       TIMESTAMPTZ,
    closed_by       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, month)
);

-- ----------------------------------------------------------------------------
-- 3. РЕЗУЛЬТАТ РАСЧЁТА: одна строка на менеджера за период.
--    breakdown хранит детализацию (засчитанные заказы, конверсия, скоринг, скидка)
--    для drill-down и контрольной сверки.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_calc (
    id                  BIGSERIAL PRIMARY KEY,
    period_id           BIGINT NOT NULL REFERENCES public.salary_period(id) ON DELETE CASCADE,
    manager_id          BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,

    -- Компоненты формулы (₽; коэффициенты — безразмерные)
    oklad               NUMERIC(12,2) NOT NULL DEFAULT 0,
    premia_zayavki      NUMERIC(12,2) NOT NULL DEFAULT 0,
    k_quality           NUMERIC(4,2)  NOT NULL DEFAULT 1,
    conv_bonus          NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_bonus      NUMERIC(12,2) NOT NULL DEFAULT 0,
    duty_pay            NUMERIC(12,2) NOT NULL DEFAULT 0,
    k_team              NUMERIC(4,2)  NOT NULL DEFAULT 1,
    total               NUMERIC(12,2) NOT NULL DEFAULT 0,  -- итого к выплате

    -- Аналитика (не триггер выплаты): маржа отгрузок для плашки «ФОТ как % маржи»
    margin_info         NUMERIC(14,2),

    breakdown           JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (period_id, manager_id)
);
CREATE INDEX IF NOT EXISTS idx_salary_calc_period ON public.salary_calc (period_id);
CREATE INDEX IF NOT EXISTS idx_salary_calc_manager ON public.salary_calc (manager_id);

-- ----------------------------------------------------------------------------
-- 4. КОРРЕКТИРОВКИ: правки по закрытому периоду переносятся в следующий
--    (возвраты/отмены после оплаты, перерасчёт маржи и т.п.).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_adjustment (
    id              BIGSERIAL PRIMARY KEY,
    period_id       BIGINT NOT NULL REFERENCES public.salary_period(id) ON DELETE CASCADE,
    manager_id      BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
    amount          NUMERIC(12,2) NOT NULL,     -- может быть отрицательной
    reason          TEXT NOT NULL,
    source_period   TEXT,                       -- к какому исходному месяцу относится (напр. '2026-06')
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_adjustment_period ON public.salary_adjustment (period_id);

-- ----------------------------------------------------------------------------
-- 5. ДЕЖУРСТВА И ТАБЕЛЬ: ручной ввод через модалку в ОКК.
--    kind='duty' — дежурная смена (× ставка); kind='worked_day' — отработанный
--    день (для пропорции оклада при найме/увольнении в середине месяца).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_duty (
    id              BIGSERIAL PRIMARY KEY,
    manager_id      BIGINT NOT NULL REFERENCES public.managers(id) ON DELETE CASCADE,
    work_date       DATE NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'duty' CHECK (kind IN ('duty','worked_day')),
    shifts          NUMERIC(4,2) NOT NULL DEFAULT 1,
    note            TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (manager_id, work_date, kind)
);
CREATE INDEX IF NOT EXISTS idx_salary_duty_manager_date ON public.salary_duty (manager_id, work_date);

-- ----------------------------------------------------------------------------
-- 6. АУДИТ: изменения конфига, пересчёты, закрытие периода, корректировки.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salary_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    entity          TEXT NOT NULL,              -- config | period | calc | adjustment | duty
    entity_id       TEXT,
    action          TEXT NOT NULL,              -- update | recalc | close | create | delete
    actor           TEXT,                       -- email
    old_value       JSONB,
    new_value       JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_audit_entity ON public.salary_audit_log (entity, created_at DESC);

-- ============================================================================
-- СИД СТАРТОВОГО КОНФИГА (как ДАННЫЕ, не дефолты в коде).
-- Значения из §4 ТЗ, действуют с 2026-07-01. Правятся в админке.
-- ВНИМАНИЕ: closing_status и discount_bonus.metric — плейсхолдеры,
-- их нужно задать в админке до первого реального расчёта (см. PLAN §9).
-- ============================================================================
INSERT INTO public.salary_config (key, value, effective_from, note, created_by) VALUES
    ('oklad', '35000'::jsonb, '2026-07-01', 'Старт §4 ТЗ', 'system'),
    ('rate_zayavka', '{"new":2000,"permanent":1000,"pech_vto":3000}'::jsonb, '2026-07-01', 'Старт §4 ТЗ', 'system'),
    ('k_quality_tiers', '[{"min":90,"k":1.2},{"min":75,"k":1.1},{"min":60,"k":1.0},{"min":40,"k":0.9},{"min":0,"k":0.8}]'::jsonb, '2026-07-01', 'Старт §4 ТЗ', 'system'),
    ('conv_bonus_tiers', '[{"min":45,"bonus":9000},{"min":35,"bonus":6000},{"min":25,"bonus":3000},{"min":0,"bonus":0}]'::jsonb, '2026-07-01', 'Старт §4 ТЗ', 'system'),
    ('conv_min_zayavki', '10'::jsonb, '2026-07-01', 'Защита от малого знаменателя §4', 'system'),
    ('discount_bonus', '{"metric":"avg_order_discount_pct","comparator":"lte","threshold":5,"bonus":5000}'::jsonb, '2026-07-01', 'Бонус, если средневзвешенная по стоимости товаров %% скидки по засчитанным заказам месяца <= threshold. threshold — настраиваемый', 'system'),
    ('duty_rate', '250'::jsonb, '2026-07-01', 'Старт §4 ТЗ', 'system'),
    ('k_team_tiers', '[{"min":20000000,"k":1.3},{"min":16000000,"k":1.15},{"min":12000000,"k":1.0},{"min":0,"k":0.5}]'::jsonb, '2026-07-01', 'Старт §4 ТЗ; нижний тир настраиваемый (DECISIONS #4)', 'system'),
    ('closing_status', '{"code":"send-assembling"}'::jsonb, '2026-07-01', 'Статус «Передано в производство» — заказ входит в базу ФОТ', 'system'),
    ('permanent_client_threshold', '2'::jsonb, '2026-07-01', 'Более 2 оплаченных за всё время = постоянный (DECISIONS #14)', 'system'),
    ('source_exclusions', '["avito","call-center","baza"]'::jsonb, '2026-07-01', 'Источники, не считаемые входящими с сайта §5', 'system'),
    ('category_pech_vto_map', '["mufelnye-pechi","pechi-dlya-piccy","sush_shso","sush_shs","sh_pe","oborudovanie-dlya-obshchepita"]'::jsonb, '2026-07-01', 'Категории каталога → печь/ВТО §5; уточнить состав', 'system'),
    ('nds_normalization', '{"rules":[{"vat_pct":0,"divisor":1.0},{"vat_pct":5,"divisor":1.05},{"vat_pct":20,"divisor":1.20}]}'::jsonb, '2026-07-01', 'Приведение к «без НДС»: 5%→/1.05, 20%→/1.20, 0%/none→как есть §5', 'system')
ON CONFLICT (key, effective_from) DO NOTHING;
