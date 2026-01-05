
-- Add Foreign Key to allow querying orders!left
ALTER TABLE public.raw_order_events
ADD CONSTRAINT fk_raw_order_events_orders
FOREIGN KEY (retailcrm_order_id)
REFERENCES public.orders (order_id)
ON DELETE SET NULL; -- Or CASCADE? Usually we want to keep events even if order is deleted locally.

-- Verify index on expected FK column
CREATE INDEX IF NOT EXISTS idx_raw_order_events_retailcrm_id_fk 
ON public.raw_order_events(retailcrm_order_id);
