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

INSERT INTO public.access_role_capabilities (
    role,
    data_scope,
    edit_scope,
    can_view_analytics,
    can_view_audit,
    can_view_reactivation,
    can_view_settings,
    can_manage_users,
    can_run_bulk_operations
)
VALUES ('demo', 'own', 'own', false, false, false, false, false, false)
ON CONFLICT (role) DO UPDATE
SET data_scope = EXCLUDED.data_scope,
    edit_scope = EXCLUDED.edit_scope,
    can_view_analytics = EXCLUDED.can_view_analytics,
    can_view_audit = EXCLUDED.can_view_audit,
    can_view_reactivation = EXCLUDED.can_view_reactivation,
    can_view_settings = EXCLUDED.can_view_settings,
    can_manage_users = EXCLUDED.can_manage_users,
    can_run_bulk_operations = EXCLUDED.can_run_bulk_operations;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'access_route_rules'
    ) THEN
        UPDATE public.access_route_rules
        SET allowed_roles = array_append(allowed_roles, 'demo'::public.app_role),
            updated_at = now()
        WHERE prefix IN ('/okk', '/api/okk')
          AND NOT ('demo'::public.app_role = ANY(allowed_roles));
    END IF;
END $$;
