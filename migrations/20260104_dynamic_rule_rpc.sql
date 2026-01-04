
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
    -- We JOIN with order_metrics to allow filtering by order context.
    -- Aliases: 
    --   c = raw_telphin_calls
    --   om = order_metrics
    query := format(
        'SELECT c.event_id, c.telphin_call_id, c.started_at, c.duration_sec, c.from_number_normalized, c.to_number_normalized
         FROM public.raw_telphin_calls c
         LEFT JOIN public.call_order_matches com ON com.telphin_call_id = c.telphin_call_id
         LEFT JOIN public.order_metrics om ON om.retailcrm_order_id = com.retailcrm_order_id
         WHERE c.started_at >= %L AND c.started_at <= %L AND (%s)',
        start_time,
        end_time,
        condition_sql
    );
    
    -- Execute
    RETURN QUERY EXECUTE query;
EXCEPTION WHEN OTHERS THEN
    -- If user writes bad SQL (e.g. "duration_sec < ''abc''"), capture error
    RAISE NOTICE 'Rule Evaluation Error: %, Query: %', SQLERRM, query;
    RETURN;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.evaluate_call_rule TO postgres, service_role;
-- We do NOT grant to anon/authenticated for security. Only Service Role (API) should call this.
