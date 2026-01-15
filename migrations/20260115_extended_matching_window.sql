CREATE OR REPLACE FUNCTION public.match_calls_to_orders(
    batch_limit INT DEFAULT 100
)
RETURNS TABLE (
    telphin_call_id TEXT,
    retailcrm_order_id INT,
    match_type TEXT,
    confidence_score NUMERIC,
    explanation TEXT,
    matching_factors JSONB
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH 
    -- 1. Get unmatched calls
    unmatched_calls AS (
        SELECT 
            c.telphin_call_id,
            CASE 
                WHEN c.direction = 'incoming' THEN c.from_number_normalized
                ELSE c.to_number_normalized
            END as client_phone_normalized,
            c.started_at as call_time,
            c.direction
        FROM public.raw_telphin_calls c
        WHERE NOT EXISTS (
            SELECT 1 FROM public.call_order_matches m 
            WHERE m.telphin_call_id = c.telphin_call_id
        )
        ORDER BY c.started_at DESC
        LIMIT batch_limit
    ),
    
    -- 2. Extract suffix
    calls_with_suffix AS (
        SELECT 
            uc.*,
            RIGHT(REGEXP_REPLACE(uc.client_phone_normalized, '[^0-9]', '', 'g'), 7) as call_suffix
        FROM unmatched_calls uc
        WHERE uc.client_phone_normalized IS NOT NULL 
          AND LENGTH(REGEXP_REPLACE(uc.client_phone_normalized, '[^0-9]', '', 'g')) >= 7
    ),
    
    -- 3a. Match against order events
    event_matches AS (
        SELECT 
            cs.telphin_call_id,
            oe.retailcrm_order_id,
            cs.call_time,
            oe.occurred_at as event_time,
            cs.direction,
            ABS(EXTRACT(EPOCH FROM (cs.call_time - oe.occurred_at))) as time_diff_sec,
            'event' as match_source
        FROM calls_with_suffix cs
        JOIN public.raw_order_events oe ON (
            RIGHT(oe.phone_normalized, 7) = cs.call_suffix
            OR RIGHT(oe.additional_phone_normalized, 7) = cs.call_suffix
        )
    ),

    -- 3b. Match against orders table
    order_matches AS (
        SELECT 
            cs.telphin_call_id,
            o.id as retailcrm_order_id,
            cs.call_time,
            o.created_at as event_time,
            cs.direction,
            ABS(EXTRACT(EPOCH FROM (cs.call_time - o.created_at))) as time_diff_sec,
            'order' as match_source
        FROM calls_with_suffix cs
        JOIN public.orders o ON (
            o.phone LIKE '%' || cs.call_suffix
            OR EXISTS (
                SELECT 1 FROM unnest(o.customer_phones) p 
                WHERE p LIKE '%' || cs.call_suffix
            )
        )
        WHERE NOT EXISTS (SELECT 1 FROM event_matches em WHERE em.telphin_call_id = cs.telphin_call_id)
    ),

    combined_raw AS (
        SELECT * FROM event_matches
        UNION ALL
        SELECT * FROM order_matches
    ),
    
    best_matches AS (
        SELECT DISTINCT ON (rm.telphin_call_id, rm.retailcrm_order_id)
            rm.*
        FROM combined_raw rm
        ORDER BY rm.telphin_call_id, rm.retailcrm_order_id, rm.time_diff_sec ASC
    )
    
    SELECT 
        bm.telphin_call_id::TEXT,
        bm.retailcrm_order_id::INT,
        (CASE 
            WHEN bm.time_diff_sec <= 600 THEN 'by_phone_time'   -- 10 min
            WHEN bm.time_diff_sec <= 172800 THEN 'by_phone_day' -- 48 hours (extended window to cover next day/weekends)
            ELSE 'by_phone_any'
        END)::TEXT as match_type,
        (CASE 
            WHEN bm.time_diff_sec <= 600 THEN 0.95    -- High
            WHEN bm.time_diff_sec <= 172800 THEN 0.85  -- Medium (within 2 days)
            ELSE 0.75                                 -- Low
        END)::NUMERIC as confidence_score,
        (CASE 
            WHEN bm.match_source = 'order' THEN 'Матч по номеру (без события)'
            WHEN bm.time_diff_sec <= 600 THEN 
                'Совпадение номера, разница ' || ROUND(bm.time_diff_sec) || ' сек'
            WHEN bm.time_diff_sec <= 172800 THEN 
                'Совпадение номера, разница ' || ROUND(bm.time_diff_sec / 3600, 1) || ' ч'
            ELSE 
                'Совпадение номера (вне рабочего окна > 48ч)'
        END)::TEXT as explanation,
        jsonb_build_object(
            'phone_match', true,
            'time_diff_sec', bm.time_diff_sec,
            'source', bm.match_source
        ) as matching_factors
    FROM best_matches bm;
END;
$$;
