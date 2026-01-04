
-- Create Rule Definitions Table
CREATE TABLE IF NOT EXISTS public.okk_rules (
    code text PRIMARY KEY,
    name text NOT NULL,
    description text,
    entity_type text NOT NULL CHECK (entity_type IN ('call', 'order', 'event')),
    condition_sql text NOT NULL, -- The WHERE clause fragment
    severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    parameters jsonb DEFAULT '{}'::jsonb, -- e.g. { "threshold": 15 }
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.okk_rules ENABLE ROW LEVEL SECURITY;

-- Policies for rules (Public Read, Service Write)
CREATE POLICY "Enable read rights for all users" ON public.okk_rules FOR SELECT USING (true);
CREATE POLICY "Enable write for service role only" ON public.okk_rules FOR ALL USING (auth.role() = 'service_role');


-- Create Violations Table (Immutable Log of Broken Rules)
-- Replaces/Enhances ad-hoc violations
CREATE TABLE IF NOT EXISTS public.okk_violations (
    id bigserial PRIMARY KEY,
    rule_code text NOT NULL REFERENCES public.okk_rules(code),
    manager_id bigint REFERENCES public.managers(id),
    order_id bigint, -- Loose reference to RetailCRM order ID (not FK strictly to allow deleted orders?) or strict? Let's keep loose or strict depending on `orders` table. strict is better.
    call_id bigint, -- Reference to raw_telphin_calls if applicable
    
    details text,   -- Human readable explanation generated at runtime
    severity text,  -- Copied from rule at moment of violation (snapshot)
    
    violation_time timestamptz NOT NULL, -- When the violation happened (e.g. call time)
    detected_at timestamptz DEFAULT now(), -- When we found it
    
    -- Constraint: prevent duplicate violation logging for same event/rule?
    -- For call rules: unique(rule_code, call_id)
    -- For order rules: tricky (stagnation happens every day). unique(rule_code, order_id, date(violation_time))?
    -- Let's stick to unique constraint to make detection idempotent.
    CONSTRAINT unique_call_violation UNIQUE NULLS NOT DISTINCT (rule_code, call_id),
    -- For non-call violations, we might need another constraint or just handle in code.
    CONSTRAINT unique_order_daily_violation UNIQUE NULLS NOT DISTINCT (rule_code, order_id, violation_time) 
    -- Note: violation_time for order stagnation is typically "now" or "start of day".
);

-- Enable RLS
ALTER TABLE public.okk_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read rights for all users" ON public.okk_violations FOR SELECT USING (true);
CREATE POLICY "Enable insert for service role only" ON public.okk_violations FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Grant permissions explicitly (to avoid Vercel issues)
GRANT ALL ON public.okk_rules TO postgres, service_role;
GRANT SELECT ON public.okk_rules TO anon, authenticated;

GRANT ALL ON public.okk_violations TO postgres, service_role;
GRANT SELECT ON public.okk_violations TO anon, authenticated;
