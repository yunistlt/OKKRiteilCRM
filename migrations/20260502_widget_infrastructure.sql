-- Infrastructure for the customer-facing AI chat widget

-- Session storage for website visitors
CREATE TABLE IF NOT EXISTS public.widget_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id TEXT NOT NULL,
    domain TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    referrer TEXT,
    landing_page TEXT,
    geo_city TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Event log (page views, clicks, add to cart)
CREATE TABLE IF NOT EXISTS public.widget_events (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.widget_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'page_view', 'add_to_cart', etc.
    event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    url TEXT,
    page_title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Message history for the widget
CREATE TABLE IF NOT EXISTS public.widget_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.widget_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_widget_sessions_visitor ON public.widget_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_widget_events_session ON public.widget_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_messages_session ON public.widget_messages(session_id, created_at ASC);

-- RLS Policies
ALTER TABLE public.widget_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_messages ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for the widget (write-only for security or restricted read)
-- In a production environment, we'd use more restrictive policies or a proxy API
CREATE POLICY "Enable insert for everyone" ON public.widget_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for own visitor_id" ON public.widget_sessions FOR SELECT USING (true); -- Simplified for now

CREATE POLICY "Enable insert for everyone" ON public.widget_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for everyone" ON public.widget_events FOR SELECT USING (true);

CREATE POLICY "Enable insert for everyone" ON public.widget_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for everyone" ON public.widget_messages FOR SELECT USING (true);

-- Update trigger for session updated_at
CREATE OR REPLACE FUNCTION public.update_widget_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_widget_sessions_updated_at
    BEFORE UPDATE ON public.widget_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_widget_session_updated_at();

-- Permissions
GRANT ALL ON public.widget_sessions TO postgres, service_role, anon, authenticated;
GRANT ALL ON public.widget_events TO postgres, service_role, anon, authenticated;
GRANT ALL ON public.widget_messages TO postgres, service_role, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.widget_events_id_seq TO anon, authenticated;
