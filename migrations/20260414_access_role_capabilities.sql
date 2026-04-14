CREATE TABLE IF NOT EXISTS public.access_role_capabilities (
    role public.app_role PRIMARY KEY,
    data_scope TEXT NOT NULL DEFAULT 'own' CHECK (data_scope IN ('own', 'team', 'all')),
    edit_scope TEXT NOT NULL DEFAULT 'own' CHECK (edit_scope IN ('own', 'team', 'all')),
    can_view_analytics BOOLEAN NOT NULL DEFAULT false,
    can_view_audit BOOLEAN NOT NULL DEFAULT false,
    can_view_reactivation BOOLEAN NOT NULL DEFAULT false,
    can_view_settings BOOLEAN NOT NULL DEFAULT false,
    can_manage_users BOOLEAN NOT NULL DEFAULT false,
    can_run_bulk_operations BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
VALUES
    ('admin', 'all', 'all', true, true, true, true, true, true),
    ('manager', 'own', 'own', false, false, false, false, false, false),
    ('okk', 'all', 'team', true, true, false, false, false, false),
    ('rop', 'team', 'team', true, true, true, false, false, true)
ON CONFLICT (role) DO NOTHING;

DROP TRIGGER IF EXISTS trg_access_role_capabilities_updated_at ON public.access_role_capabilities;
CREATE TRIGGER trg_access_role_capabilities_updated_at
    BEFORE UPDATE ON public.access_role_capabilities
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();