-- Persistent storage for OKK consultant threads, messages and audit logs

CREATE TABLE IF NOT EXISTS public.okk_consultant_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    username TEXT,
    order_id BIGINT REFERENCES public.orders(order_id) ON DELETE SET NULL,
    branch_key TEXT NOT NULL DEFAULT 'main',
    title TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.okk_consultant_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.okk_consultant_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.okk_consultant_logs (
    id BIGSERIAL PRIMARY KEY,
    trace_id UUID NOT NULL DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES public.okk_consultant_threads(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    order_id BIGINT REFERENCES public.orders(order_id) ON DELETE SET NULL,
    criterion_key TEXT,
    intent TEXT,
    question TEXT NOT NULL,
    answer_preview TEXT,
    used_fallback BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_okk_consultant_threads_user_order ON public.okk_consultant_threads(user_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_okk_consultant_messages_thread_created ON public.okk_consultant_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_okk_consultant_logs_order_created ON public.okk_consultant_logs(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_okk_consultant_logs_trace ON public.okk_consultant_logs(trace_id);

ALTER TABLE public.okk_consultant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okk_consultant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okk_consultant_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read for all users" ON public.okk_consultant_threads;
CREATE POLICY "Enable read for all users" ON public.okk_consultant_threads FOR SELECT USING (true);
DROP POLICY IF EXISTS "Enable write for service role only" ON public.okk_consultant_threads;
CREATE POLICY "Enable write for service role only" ON public.okk_consultant_threads FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Enable read for all users" ON public.okk_consultant_messages;
CREATE POLICY "Enable read for all users" ON public.okk_consultant_messages FOR SELECT USING (true);
DROP POLICY IF EXISTS "Enable write for service role only" ON public.okk_consultant_messages;
CREATE POLICY "Enable write for service role only" ON public.okk_consultant_messages FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Enable read for all users" ON public.okk_consultant_logs;
CREATE POLICY "Enable read for all users" ON public.okk_consultant_logs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Enable write for service role only" ON public.okk_consultant_logs;
CREATE POLICY "Enable write for service role only" ON public.okk_consultant_logs FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON public.okk_consultant_threads TO anon, authenticated;
GRANT SELECT ON public.okk_consultant_messages TO anon, authenticated;
GRANT SELECT ON public.okk_consultant_logs TO anon, authenticated;
GRANT ALL ON public.okk_consultant_threads TO postgres, service_role;
GRANT ALL ON public.okk_consultant_messages TO postgres, service_role;
GRANT ALL ON public.okk_consultant_logs TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.update_okk_consultant_thread_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_okk_consultant_threads_updated_at ON public.okk_consultant_threads;
CREATE TRIGGER trg_okk_consultant_threads_updated_at
    BEFORE UPDATE ON public.okk_consultant_threads
    FOR EACH ROW EXECUTE FUNCTION public.update_okk_consultant_thread_updated_at();

COMMENT ON TABLE public.okk_consultant_threads IS 'Branches/threads of the OKK consultant per user and order context.';
COMMENT ON TABLE public.okk_consultant_messages IS 'Persistent message history for OKK consultant conversations.';
COMMENT ON TABLE public.okk_consultant_logs IS 'Audit log of OKK consultant requests, intents and previews.';