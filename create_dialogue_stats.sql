-- Create dialogue_stats table for caching analytics
CREATE TABLE IF NOT EXISTS public.dialogue_stats (
    manager_id TEXT PRIMARY KEY,
    d1_count INTEGER DEFAULT 0,
    d1_duration INTEGER DEFAULT 0,
    d7_count INTEGER DEFAULT 0,
    d7_duration INTEGER DEFAULT 0,
    d30_count INTEGER DEFAULT 0,
    d30_duration INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.dialogue_stats ENABLE ROW LEVEL SECURITY;

-- Simple permissive policy for service role/authenticated access
CREATE POLICY "Enable all for service role" ON public.dialogue_stats 
    USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON public.dialogue_stats TO service_role;
GRANT ALL ON public.dialogue_stats TO anon;
GRANT ALL ON public.dialogue_stats TO authenticated;
