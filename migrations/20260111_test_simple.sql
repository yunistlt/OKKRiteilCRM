-- Упрощенная тестовая SQL функция для матчинга звонков
-- Версия без сложных LATERAL JOIN для начального тестирования

CREATE OR REPLACE FUNCTION test_match_calls_simple(
    batch_limit INT DEFAULT 50
)
RETURNS TABLE (
    matches_found INT,
    execution_time_ms INT
) 
LANGUAGE plpgsql
AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    match_count INT;
BEGIN
    start_time := clock_timestamp();
    
    -- Простой подсчет потенциальных матчей
    SELECT COUNT(*) INTO match_count
    FROM raw_telphin_calls c
    WHERE NOT EXISTS (
        SELECT 1 FROM call_order_matches m 
        WHERE m.telphin_call_id = c.telphin_call_id
    )
    LIMIT batch_limit;
    
    end_time := clock_timestamp();
    
    RETURN QUERY
    SELECT 
        match_count,
        EXTRACT(MILLISECONDS FROM (end_time - start_time))::INT;
END;
$$;

COMMENT ON FUNCTION test_match_calls_simple IS 
'Упрощенная тестовая функция для проверки работы SQL функций в Supabase';
