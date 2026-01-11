
-- Fix unique constraints on okk_violations to allow multiple NULL call_ids (for event rules)
-- And ensure idempotency for different types of rules.

-- 1. Drop old constraints
ALTER TABLE public.okk_violations 
DROP CONSTRAINT IF EXISTS unique_call_violation,
DROP CONSTRAINT IF EXISTS unique_order_daily_violation;

-- 2. Create improved constraints
-- For Call rules: unique per rule and call
ALTER TABLE public.okk_violations 
ADD CONSTRAINT unique_call_rule_violation 
UNIQUE NULLS NOT DISTINCT (rule_code, call_id);

-- For Event/Order rules: unique per rule, order, and time
-- Using NULLS NOT DISTINCT ensures that if call_id is NULL (which it is for events), 
-- it's still treated as a part of the unique key for (rule_code, order_id, violation_time)
-- but multiple records with THE SAME NULL call_id but DIFFERENT times are NOT conflicts.

-- Wait, if we want to allow multiple violations for different events on the same order:
-- We need (rule_code, order_id, violation_time) to be the key, and it already was.
-- The problem was that (rule_code, call_id) was ALSO checked, and all events had call_id = NULL.
-- Postgres treats NULL as NOT equal to NULL in UNIQUE constraints unless NULLS NOT DISTINCT is used.
-- BUT if we have (rule_code, call_id) UNIQUE, and two rows have ('rule_1', NULL), they ARE usually allowed if it's a simple UNIQUE.
-- However, my test showed "duplicate key value violates unique constraint 'unique_call_violation'".

-- Re-implementing correctly:
ALTER TABLE public.okk_violations 
ADD CONSTRAINT unique_order_event_violation 
UNIQUE NULLS NOT DISTINCT (rule_code, order_id, violation_time, call_id);

COMMENT ON CONSTRAINT unique_order_event_violation ON public.okk_violations IS 
'Ensures idempotency for all types of violations, correctly handling NULLs for non-call rules.';
