DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'app_role' AND n.nspname = 'public'
    ) THEN
        ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'demo';
    END IF;
END $$;
