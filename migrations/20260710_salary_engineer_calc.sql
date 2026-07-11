-- ============================================================================
-- Результат расчёта ЗП по инженерам-расчётчикам — отдельная таблица (не
-- salary_calc, который жёстко ключится числовым manager_id). Изолированный путь:
-- ключ = item_code элемента справочника «Инженера ОП». Пишется тем же recalc,
-- что и менеджеры, в тот же период.
--
-- + Сид новых конфиг-ключей (engineer_field / engineer_calc_status). Обязателен:
--   getResolvedConfig бросает на любом незаданном ключе. effective_from раньше
--   любого расчётного периода, чтобы резолв конфига не ломался задним числом.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.salary_engineer_calc (
    id           BIGSERIAL PRIMARY KEY,
    period_id    BIGINT NOT NULL REFERENCES public.salary_period(id) ON DELETE CASCADE,
    item_code    TEXT NOT NULL,             -- код элемента справочника «Инженера ОП»
    scheme_code  TEXT,
    total        NUMERIC NOT NULL DEFAULT 0,
    breakdown    JSONB,                     -- вклад блоков + заказы (для отчёта)
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (period_id, item_code)
);

INSERT INTO public.salary_config (key, value, effective_from, note, created_by) VALUES
    ('engineer_field', '{"code":"inzhener_zakaza"}'::jsonb, '2026-01-01',
     'Код кастом-поля заказа с инженером-расчётчиком (справочник «Инженера ОП»)', 'system'),
    ('engineer_calc_status', '{"start":"v-proscete","end":"na-soglasovanii"}'::jsonb, '2026-01-01',
     'Статусы таймера скорости расчёта: старт (В просчёте) → конец (Согласование параметров заказа)', 'system')
ON CONFLICT (key, effective_from) DO NOTHING;
