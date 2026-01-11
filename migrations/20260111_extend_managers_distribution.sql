-- Migration: Extend managers table for Smart Distribution

-- 1. Add columns if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'managers' AND column_name = 'rating') THEN
        ALTER TABLE public.managers ADD COLUMN rating FLOAT DEFAULT 5.0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'managers' AND column_name = 'categories') THEN
        ALTER TABLE public.managers ADD COLUMN categories TEXT[] DEFAULT '{}';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'managers' AND column_name = 'max_load') THEN
        ALTER TABLE public.managers ADD COLUMN max_load INTEGER DEFAULT 20;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'managers' AND column_name = 'current_active_orders') THEN
        ALTER TABLE public.managers ADD COLUMN current_active_orders INTEGER DEFAULT 0;
    END IF;
END $$;

COMMENT ON COLUMN public.managers.rating IS 'Manager rating (0-10) for distribution priority';
COMMENT ON COLUMN public.managers.categories IS 'List of RetailCRM category codes this manager specializes in';
COMMENT ON COLUMN public.managers.max_load IS 'Maximum number of active orders this manager can handle';
COMMENT ON COLUMN public.managers.current_active_orders IS 'Number of orders currently assigned to this manager';
