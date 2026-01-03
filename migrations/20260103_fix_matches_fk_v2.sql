-- ============================================
-- MIGRATION: Fix Foreign Keys for Matching (v2)
-- ============================================

-- 1. Ensure columns are unique (REQUIRED for Foreign Key)
-- CREATE UNIQUE INDEX CONCURRENTLY cannot be run in transaction block of standard migration
-- So we use standard ADD CONSTRAINT

DO $$ 
BEGIN
    -- Проверяем, есть ли уже уникальность на order_id
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'orders_order_id_key' OR conname = 'unique_order_id'
    ) THEN
        -- Если нет, добавляем
        ALTER TABLE public.orders ADD CONSTRAINT unique_order_id UNIQUE (order_id);
    END IF;
END $$;

-- 2. Add Foreign Key: call_order_matches.retailcrm_order_id -> orders.order_id
-- Сначала удаляем, если вдруг есть (для идемпотентности)
ALTER TABLE public.call_order_matches 
DROP CONSTRAINT IF EXISTS fk_call_order_matches_order;

ALTER TABLE public.call_order_matches
ADD CONSTRAINT fk_call_order_matches_order
FOREIGN KEY (retailcrm_order_id)
REFERENCES public.orders(order_id)
ON DELETE CASCADE;

-- 3. Add Foreign Key: call_order_matches.telphin_call_id -> raw_telphin_calls.telphin_call_id
ALTER TABLE public.call_order_matches 
DROP CONSTRAINT IF EXISTS fk_call_order_matches_call;

ALTER TABLE public.call_order_matches
ADD CONSTRAINT fk_call_order_matches_call
FOREIGN KEY (telphin_call_id)
REFERENCES public.raw_telphin_calls(telphin_call_id)
ON DELETE CASCADE;

-- 4. Rename old matches table (DEPRECATED)
-- Проверяем, что ещё не переименована
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'matches') THEN
        ALTER TABLE public.matches RENAME TO matches_deprecated;
    END IF;
END $$;
