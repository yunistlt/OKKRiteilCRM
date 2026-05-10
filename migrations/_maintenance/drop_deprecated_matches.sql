-- Drop the deprecated matches table
DROP TABLE IF EXISTS public.matches_deprecated;

-- Make sure we don't have other legacy tables
-- DROP TABLE IF EXISTS public.calls_deprecated; -- (If exists, do not uncomment unless sure)

-- Verify that call_order_matches is the main table
COMMENT ON TABLE public.call_order_matches IS 'INTERPRETED: Main table for call-order links (replaced matches_deprecated)';
