-- Table for tracking Telphin callback requests from the widget
CREATE TABLE IF NOT EXISTS public.widget_callback_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.widget_sessions(id) ON DELETE SET NULL,
    visitor_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',           -- Request received, call not yet initiated
        'calling_manager',   -- ATС is calling managers (Leg A)
        'calling_customer',  -- Manager picked up, ATС is calling customer (Leg B)
        'completed',         -- Successfully connected and finished
        'failed',            -- Failed after all retries (managers didn't answer or customer didn't answer)
        'cancelled'          -- Cancelled by system or user
    )),
    telphin_call_id TEXT,    -- ID from Telphin system to correlate webhooks
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 10,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for searching by phone and status (idempotency)
CREATE INDEX IF NOT EXISTS idx_widget_callback_active 
    ON public.widget_callback_requests(phone, status) 
    WHERE status IN ('pending', 'calling_manager', 'calling_customer');

-- Index for correlating webhooks
CREATE INDEX IF NOT EXISTS idx_widget_callback_telphin_id 
    ON public.widget_callback_requests(telphin_call_id);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_widget_callback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_widget_callback_updated_at
    BEFORE UPDATE ON public.widget_callback_requests
    FOR EACH ROW EXECUTE FUNCTION public.update_widget_callback_updated_at();

-- Permissions
ALTER TABLE public.widget_callback_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.widget_callback_requests TO postgres, service_role, anon, authenticated;

-- Policies
CREATE POLICY "Enable insert for anonymous widget" ON public.widget_callback_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for own requests" ON public.widget_callback_requests FOR SELECT USING (true);

COMMENT ON TABLE public.widget_callback_requests IS 'Requests for automated callbacks via Telphin initiated from the chat widget';
