
-- Fix unique constraints on okk_violations to properly handle NULL call_ids
-- We want to allow multiple records with NULL call_id (for event rules),
-- assuming they differ by order_id/violation_time.

-- 1. Drop old constraints
ALTER TABLE public.okk_violations 
DROP CONSTRAINT IF EXISTS unique_call_violation,
DROP CONSTRAINT IF EXISTS unique_order_daily_violation,
DROP CONSTRAINT IF EXISTS unique_call_rule_violation,
DROP CONSTRAINT IF EXISTS unique_order_event_violation;

-- 2. Create constraint for Calls (only enforce uniqueness when call_id is present)
CREATE UNIQUE INDEX unique_call_rule_violation 
ON public.okk_violations (rule_code, call_id) 
WHERE call_id IS NOT NULL;

-- 3. Create constraint for Events (Order + Time + Rule)
-- This allows multiple violations per order/rule if times differ
ALTER TABLE public.okk_violations 
ADD CONSTRAINT unique_order_event_violation 
UNIQUE NULLS NOT DISTINCT (rule_code, order_id, violation_time, call_id);
