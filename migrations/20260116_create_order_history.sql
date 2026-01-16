
-- ============================================
-- ORDER HISTORY LOG
-- ============================================

CREATE TABLE IF NOT EXISTS public.order_history_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- RetailCRM specific history ID (for idempotency)
    retailcrm_history_id INT NOT NULL,
    -- Which order this belongs to
    retailcrm_order_id INT NOT NULL,
    
    -- What changed
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    
    -- Who changed it
    user_data JSONB, -- { "id": 123, "name": "Manager Name" }
    
    -- When it happened (in reality)
    occurred_at TIMESTAMPTZ NOT NULL,
    
    -- When we synced it
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_history_entry UNIQUE(retailcrm_history_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON public.order_history_log(retailcrm_order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_occurred_at ON public.order_history_log(occurred_at DESC);

-- RLS
ALTER TABLE public.order_history_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.order_history_log
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON public.order_history_log TO service_role, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.order_history_log_id_seq TO service_role, anon, authenticated;

COMMENT ON TABLE public.order_history_log IS 'Log of changes from RetailCRM (order history)';
