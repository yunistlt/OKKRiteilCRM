-- Сохранённые фильтры списка заказов — как в RetailCRM («Заказы на завтра», «Потеряшки»…).
-- Набор условий храним как есть: панель меняется, а таблица не должна меняться следом.

CREATE TABLE IF NOT EXISTS public.order_filter_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    owner_user_id UUID,                  -- NULL = общий для отдела, иначе личный фильтр
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_filter_presets_owner ON public.order_filter_presets(owner_user_id, sort_order);

ALTER TABLE public.order_filter_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.order_filter_presets;
CREATE POLICY "service role full access" ON public.order_filter_presets FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_order_filter_presets_touch ON public.order_filter_presets;
CREATE TRIGGER trg_order_filter_presets_touch BEFORE UPDATE ON public.order_filter_presets
    FOR EACH ROW EXECUTE FUNCTION public.touch_template_updated_at();

COMMENT ON TABLE public.order_filter_presets IS 'Сохранённые наборы фильтров списка заказов';
