
-- Add Foreign Key to order_metrics to allow rich context joins
ALTER TABLE public.raw_order_events
ADD CONSTRAINT fk_raw_order_events_metrics
FOREIGN KEY (retailcrm_order_id)
REFERENCES public.order_metrics (retailcrm_order_id)
ON DELETE SET NULL;

-- Reload schema for API
NOTIFY pgrst, 'reload schema';
