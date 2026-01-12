
-- Drop foreign key constraints on raw_order_events to unblock history sync
-- This allows capturing history events for orders that haven't been synced yet.

ALTER TABLE public.raw_order_events DROP CONSTRAINT IF EXISTS fk_raw_order_events_orders;
ALTER TABLE public.raw_order_events DROP CONSTRAINT IF EXISTS fk_raw_order_events_metrics;

-- We keep the index for join performance even without the formal constraint
CREATE INDEX IF NOT EXISTS idx_raw_order_events_retailcrm_id_fk 
ON public.raw_order_events(retailcrm_order_id);
