-- «Зарплата ИИ»: учёт расходов на LLM по каждому агенту.
-- На каждый вызов модели пишем токены и стоимость (снимок в USD на момент вызова),
-- привязанные к agent_id. На карточке агента показываем стоимость за месяц в рублях
-- (по курсу из настройки). Тарифы и курс — в БД, без хардкода (как ставки ЗП).

-- 1) Тарифы моделей (USD за 1М токенов). Снимок цен; меняется по мере изменения прайса OpenAI.
CREATE TABLE IF NOT EXISTS public.ai_model_pricing (
    model TEXT PRIMARY KEY,
    input_per_1m   NUMERIC(12,4) NOT NULL DEFAULT 0,   -- вход
    cached_input_per_1m NUMERIC(12,4) NOT NULL DEFAULT 0, -- кэшированный вход (дешевле)
    output_per_1m  NUMERIC(12,4) NOT NULL DEFAULT 0,   -- выход
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ai_model_pricing (model, input_per_1m, cached_input_per_1m, output_per_1m, note) VALUES
    ('gpt-4o',                  2.50, 1.25, 10.00, 'OpenAI gpt-4o'),
    ('gpt-4o-mini',             0.15, 0.075, 0.60, 'OpenAI gpt-4o-mini'),
    ('gpt-4.1',                 2.00, 0.50,  8.00, 'OpenAI gpt-4.1'),
    ('gpt-4.1-mini',            0.40, 0.10,  1.60, 'OpenAI gpt-4.1-mini'),
    ('gpt-4-turbo-preview',    10.00, 0.00, 30.00, 'OpenAI gpt-4-turbo (генерация правил)'),
    ('gpt-4-turbo',            10.00, 0.00, 30.00, 'OpenAI gpt-4-turbo'),
    ('text-embedding-3-small',  0.02, 0.00,  0.00, 'эмбеддинги (только вход)'),
    ('text-embedding-3-large',  0.13, 0.00,  0.00, 'эмбеддинги (только вход)'),
    ('text-embedding-ada-002',  0.10, 0.00,  0.00, 'эмбеддинги (только вход)')
ON CONFLICT (model) DO NOTHING;

-- 2) Настройка курса USD→RUB (singleton). Редактируется в интерфейсе.
CREATE TABLE IF NOT EXISTS public.ai_cost_settings (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    usd_to_rub NUMERIC(10,2) NOT NULL DEFAULT 90.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ai_cost_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 3) Журнал использования LLM по агентам. Одна строка = один вызов модели.
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,                 -- katerina|semen|anna|maxim|elena|lev|darya|... либо служебная категория
    model TEXT,
    purpose TEXT,                           -- что делал вызов (короткий код), для разбивки
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,   -- из prompt_tokens_details.cached_tokens
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,  -- снимок стоимости на момент вызова
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_agent_time_idx ON public.ai_usage_events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_time_idx ON public.ai_usage_events (created_at DESC);

-- 4) Доступ только service_role.
ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cost_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_model_pricing_service_role ON public.ai_model_pricing;
CREATE POLICY ai_model_pricing_service_role ON public.ai_model_pricing FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS ai_cost_settings_service_role ON public.ai_cost_settings;
CREATE POLICY ai_cost_settings_service_role ON public.ai_cost_settings FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS ai_usage_events_service_role ON public.ai_usage_events;
CREATE POLICY ai_usage_events_service_role ON public.ai_usage_events FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
