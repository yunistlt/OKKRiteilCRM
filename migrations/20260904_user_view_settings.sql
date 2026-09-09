-- Личные настройки отображения: какие колонки и какие поля фильтра показывать и в каком порядке.
-- В RetailCRM это две шестерёнки на экране заказов; настройка своя у каждого пользователя.

CREATE TABLE IF NOT EXISTS public.user_view_settings (
    user_id UUID NOT NULL,
    view_key TEXT NOT NULL,              -- напр. orders.columns, orders.filters
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, view_key)
);

ALTER TABLE public.user_view_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.user_view_settings;
CREATE POLICY "service role full access" ON public.user_view_settings FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.user_view_settings IS 'Личные настройки экранов: состав и порядок колонок, состав полей фильтра';
