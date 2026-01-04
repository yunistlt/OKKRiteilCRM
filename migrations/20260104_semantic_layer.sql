
-- =============================================
-- SEMANTIC LAYER (Phase 3)
-- =============================================

-- 1. Add Call Transcript Storage
-- We store the text of the call here.
ALTER TABLE public.raw_telphin_calls 
ADD COLUMN IF NOT EXISTS transcript text,
ADD COLUMN IF NOT EXISTS transcription_status text DEFAULT 'pending'; 
-- status: 'pending', 'processing', 'completed', 'failed', 'skipped' (too short)

-- 2. Add Semantic Rule Capabilities
-- Rules can now be 'sql' (metadata) or 'semantic' (LLM-based).
ALTER TABLE public.okk_rules 
ADD COLUMN IF NOT EXISTS rule_type text DEFAULT 'sql', -- 'sql' or 'semantic'
ADD COLUMN IF NOT EXISTS semantic_prompt text; -- The prompt for the LLM

-- 3. Add Explainability to Violations
-- Which exact part of the text triggered the rule?
ALTER TABLE public.okk_violations 
ADD COLUMN IF NOT EXISTS evidence_text text; -- Quote from transcript
