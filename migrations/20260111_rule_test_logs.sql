-- Create Rule Test Logs Table
-- Stores results of rule validation tests
DROP TABLE IF EXISTS public.okk_rule_test_logs CASCADE;

CREATE TABLE public.okk_rule_test_logs (
    id bigserial PRIMARY KEY,
    rule_code text NOT NULL REFERENCES public.okk_rules(code) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('success', 'failure', 'error')),
    message text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.okk_rule_test_logs ENABLE ROW LEVEL SECURITY;

-- Policies for logs (Public Read, Service Write)
DROP POLICY IF EXISTS "Enable read for all users" ON public.okk_rule_test_logs;
CREATE POLICY "Enable read for all users" ON public.okk_rule_test_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable write for service role only" ON public.okk_rule_test_logs;
CREATE POLICY "Enable write for service role only" ON public.okk_rule_test_logs FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.okk_rule_test_logs TO postgres, service_role;
GRANT SELECT ON public.okk_rule_test_logs TO anon, authenticated;

COMMENT ON TABLE public.okk_rule_test_logs IS 'Stores history and results of synthetic tests for OKK rules.';
