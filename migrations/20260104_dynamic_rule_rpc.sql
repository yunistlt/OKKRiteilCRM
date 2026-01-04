
-- =============================================
-- DYNAMIC RULE ENGINE (RPC Functions)
-- =============================================

-- 1. Evaluator for Call Rules
-- Accepts a partial WHERE clause (e.g. "duration_sec < 10")
-- Returns matching calls in the time range.

DROP FUNCTION IF EXISTS public.evaluate_call_rule(text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.evaluate_call_rule(
    condition_sql text,
    start_time timestamptz,
    end_time timestamptz
)
RETURNS TABLE (
    event_id bigint,
    telphin_call_id bigint,
    started_at timestamptz,
    duration_sec int,
    from_number text,
    to_number text
) 
LANGUAGE plpgsql
SECURITY DEFINER -- Run as owner (access to raw tables)
AS $$
DECLARE
    query text;
BEGIN
    -- Validate inputs to prevent massive injection (basic check)
    IF condition_sql IS NULL OR length(trim(condition_sql)) = 0 THEN
        RETURN;
    END IF;

    -- Construct Dynamic Query
    -- We force the time range index usage for performance.
    query := format(
        'SELECT event_id, telphin_call_id, started_at, duration_sec, from_number_normalized, to_number_normalized
         FROM public.raw_telphin_calls
         WHERE started_at >= %L AND started_at <= %L AND (%s)',
        start_time,
        end_time,
        condition_sql
    );
    
    -- Execute
    RETURN QUERY EXECUTE query;
EXCEPTION WHEN OTHERS THEN
    -- If user writes bad SQL (e.g. "duration_sec < 'abc'"), capture error
    RAISE NOTICE 'Rule Evaluation Error: %', SQLERRM;
    RETURN;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.evaluate_call_rule TO postgres, service_role;
-- We do NOT grant to anon/authenticated for security. Only Service Role (API) should call this.
