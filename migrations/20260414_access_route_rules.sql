CREATE TABLE IF NOT EXISTS public.access_route_rules (
    prefix TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    allowed_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin']::public.app_role[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_route_rules_category
    ON public.access_route_rules (category);

DROP TRIGGER IF EXISTS trg_access_route_rules_updated_at ON public.access_route_rules;
CREATE TRIGGER trg_access_route_rules_updated_at
    BEFORE UPDATE ON public.access_route_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();