-- ============================================
-- MIGRATION: Fix Foreign Keys for Matching
-- ============================================

-- 1. Ensure columns are unique (they should be, but just in case)
-- orders.order_id is usually PK, but let's make sure
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'orders_order_id_key' OR conname = 'orders_pkey'
    ) THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_order_id_unique UNIQUE (order_id);
    END IF;
END $$;

-- 2. Add Foreign Key: call_order_matches.retailcrm_order_id -> orders.order_id
ALTER TABLE public.call_order_matches
ADD CONSTRAINT fk_call_order_matches_order
FOREIGN KEY (retailcrm_order_id)
REFERENCES public.orders(order_id)
ON DELETE CASCADE; -- If order is deleted, match is deleted (mostly for safe cleanup)

-- 3. Add Foreign Key: call_order_matches.telphin_call_id -> raw_telphin_calls.telphin_call_id
ALTER TABLE public.call_order_matches
ADD CONSTRAINT fk_call_order_matches_call
FOREIGN KEY (telphin_call_id)
REFERENCES public.raw_telphin_calls(telphin_call_id)
ON DELETE CASCADE;

-- 4. Rename old matches table (DEPRECATED)
ALTER TABLE public.matches RENAME TO matches_deprecated;

-- 5. Add comment
COMMENT ON TABLE public.call_order_matches IS 'Source of truth for Call-Order links. Replaces matches table.';
