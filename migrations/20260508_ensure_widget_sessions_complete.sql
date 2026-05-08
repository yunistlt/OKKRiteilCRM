-- Гарантируем что у widget_sessions есть все нужные колонки
-- Эта миграция безопасна: IF NOT EXISTS предотвращает ошибки если колонки уже есть

-- Базовые колонки (должны быть из базовой миграции)
ALTER TABLE public.widget_sessions
    ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS visitor_id TEXT NOT NULL,
    ADD COLUMN IF NOT EXISTS domain TEXT,
    ADD COLUMN IF NOT EXISTS utm_source TEXT,
    ADD COLUMN IF NOT EXISTS utm_medium TEXT,
    ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
    ADD COLUMN IF NOT EXISTS utm_content TEXT,
    ADD COLUMN IF NOT EXISTS utm_term TEXT,
    ADD COLUMN IF NOT EXISTS referrer TEXT,
    ADD COLUMN IF NOT EXISTS landing_page TEXT,
    ADD COLUMN IF NOT EXISTS geo_city TEXT,
    ADD COLUMN IF NOT EXISTS user_agent TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Расширенные колонки (из 20260506_widget_sessions_extend.sql)
ALTER TABLE public.widget_sessions
    ADD COLUMN IF NOT EXISTS nickname TEXT,
    ADD COLUMN IF NOT EXISTS has_contacts BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS interested_products TEXT[],
    ADD COLUMN IF NOT EXISTS contact_name TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS contact_company TEXT,
    ADD COLUMN IF NOT EXISTS crm_order_id BIGINT,
    ADD COLUMN IF NOT EXISTS crm_customer_id BIGINT,
    ADD COLUMN IF NOT EXISTS manager_took_over BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS manager_notes TEXT;

-- Убедимся что индексы есть
CREATE INDEX IF NOT EXISTS idx_widget_sessions_visitor ON public.widget_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_widget_sessions_contact_email ON public.widget_sessions(contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widget_sessions_no_contacts ON public.widget_sessions(created_at) WHERE has_contacts = false AND interested_products IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widget_sessions_crm_order ON public.widget_sessions(crm_order_id) WHERE crm_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_widget_sessions_has_contacts ON public.widget_sessions(has_contacts) WHERE has_contacts = true;

-- Убедимся что RLS включен
ALTER TABLE public.widget_sessions ENABLE ROW LEVEL SECURITY;

-- Убедимся что политики есть
DROP POLICY IF EXISTS "Enable insert for everyone" ON public.widget_sessions;
DROP POLICY IF EXISTS "Enable select for own visitor_id" ON public.widget_sessions;

CREATE POLICY "Enable insert for everyone" ON public.widget_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for everyone" ON public.widget_sessions FOR SELECT USING (true);

-- Убедимся что триггер обновления updated_at существует
DROP TRIGGER IF EXISTS trg_widget_sessions_updated_at ON public.widget_sessions;

CREATE OR REPLACE FUNCTION public.update_widget_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_widget_sessions_updated_at
    BEFORE UPDATE ON public.widget_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_widget_session_updated_at();

-- Убедимся что права доступа правильные
GRANT ALL ON public.widget_sessions TO postgres, service_role, anon, authenticated;
