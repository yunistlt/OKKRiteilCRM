-- Add insights column to store AI-extracted business facts
ALTER TABLE public.order_metrics 
ADD COLUMN IF NOT EXISTS insights JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.order_metrics.insights IS 'AI-synthesized business facts (LPR, budget, pain points, etc)';
