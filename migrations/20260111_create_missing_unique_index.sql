-- Fix missing unique index for violations
-- This prevents duplicates even when call_id is NULL (for event-based rules)

-- 1. Drop old attempts
DROP INDEX IF EXISTS unique_call_rule_violation_idx;
ALTER TABLE okk_violations DROP CONSTRAINT IF EXISTS unique_call_rule_violation;

-- 2. Create the index (Try Postgres 15+ syntax first)
CREATE UNIQUE INDEX okk_violations_dedup_idx ON okk_violations (order_id, rule_code, call_id) NULLS NOT DISTINCT;

-- IF THE ABOVE FAILS with "syntax error", it means Postgres is older than v15.
-- IN THAT CASE, run this instead:
-- CREATE UNIQUE INDEX okk_violations_dedup_idx ON okk_violations (order_id, rule_code, COALESCE(call_id, -1));
-- (And we would need to update the application to use COALESCE index, which is harder).
-- Ideally, Supabase is on PG15.
