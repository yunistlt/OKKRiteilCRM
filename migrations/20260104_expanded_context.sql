
-- =============================================
-- EXPANDED CONTEXT (Phase 3.3+)
-- =============================================

-- We expand order_metrics to include "rich" data for AI.
-- This allows rules like: "If customer is VIP...", "If purchased iPhone..."

ALTER TABLE public.order_metrics 
ADD COLUMN IF NOT EXISTS full_order_context JSONB; -- The entire Order Dump (Universal Context)

COMMENT ON COLUMN public.order_metrics.full_order_context IS 'Universal Context: Full JSON dump of the order from RetailCRM/Source used for AI Deep Querying';
