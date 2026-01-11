-- Тестовая SQL функция для матчинга звонков с заказами
-- Делает все в одном запросе вместо 500+ запросов из Node.js

CREATE OR REPLACE FUNCTION test_match_calls_to_orders(
    batch_limit INT DEFAULT 50
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
    -- 1. Получаем несматченные звонки
    unmatched_calls AS (
        SELECT 
            c.telphin_call_id,
            c.from_number,
            c.to_number,
            c.from_number_normalized,
            c.to_number_normalized,
            c.started_at,
            c.direction,
            -- Определяем номер клиента
            CASE 
                WHEN c.direction = 'incoming' THEN c.from_number_normalized
                ELSE c.to_number_normalized
            END as client_phone_normalized
        FROM raw_telphin_calls c
        WHERE NOT EXISTS (
            SELECT 1 FROM call_order_matches m 
            WHERE m.telphin_call_id = c.telphin_call_id
        )
        ORDER BY c.started_at DESC
        LIMIT batch_limit
    ),
    
    -- 2. Для каждого звонка находим кандидатов заказов по последним 7 цифрам
    call_order_candidates AS (
        SELECT 
            uc.telphin_call_id,
            uc.started_at as call_time,
            uc.direction,
            uc.client_phone_normalized,
            oe.retailcrm_order_id,
            oe.occurred_at as event_time,
            oe.phone,
            oe.phone_normalized,
            oe.additional_phone_normalized,
            -- Последние 7 цифр
            RIGHT(REGEXP_REPLACE(uc.client_phone_normalized, '[^0-9]', '', 'g'), 7) as call_suffix,
            RIGHT(REGEXP_REPLACE(oe.phone_normalized, '[^0-9]', '', 'g'), 7) as order_phone_suffix,
            RIGHT(REGEXP_REPLACE(COALESCE(oe.additional_phone_normalized, ''), '[^0-9]', '', 'g'), 7) as order_additional_suffix
        FROM unmatched_calls uc
        CROSS JOIN LATERAL (
            SELECT DISTINCT ON (oe.retailcrm_order_id)
                oe.retailcrm_order_id,
                oe.phone,
                oe.phone_normalized,
                oe.additional_phone_normalized,
                oe.occurred_at
            FROM raw_order_events oe
            WHERE 
                oe.phone_normalized IS NOT NULL
                AND (
                    oe.phone_normalized LIKE '%' || RIGHT(REGEXP_REPLACE(uc.client_phone_normalized, '[^0-9]', '', 'g'), 7)
                    OR oe.additional_phone_normalized LIKE '%' || RIGHT(REGEXP_REPLACE(uc.client_phone_normalized, '[^0-9]', '', 'g'), 7)
                )
            ORDER BY oe.retailcrm_order_id, oe.occurred_at DESC
        ) oe
    ),
    
    -- 3. Вычисляем совпадения и confidence
    matches AS (
        SELECT 
            coc.telphin_call_id,
            coc.retailcrm_order_id,
            coc.call_time,
            coc.event_time,
            coc.direction,
            -- Проверяем совпадение по последним 7 цифрам
            (coc.call_suffix = coc.order_phone_suffix OR coc.call_suffix = coc.order_additional_suffix) as phone_match,
            -- Разница во времени в секундах
            ABS(EXTRACT(EPOCH FROM (coc.call_time - coc.event_time))) as time_diff_sec
        FROM call_order_candidates coc
        WHERE 
            -- Только если есть совпадение по номеру
            (coc.call_suffix = coc.order_phone_suffix OR coc.call_suffix = coc.order_additional_suffix)
    )
    
    -- 4. Формируем финальный результат с типом матча и confidence
    SELECT 
        m.telphin_call_id::TEXT,
        m.retailcrm_order_id::INT,
        CASE 
            WHEN m.time_diff_sec <= 300 THEN 'by_phone_time'
            WHEN m.time_diff_sec <= 1800 THEN 'by_phone_time'
            ELSE 'by_phone_manager'
        END::TEXT as match_type,
        CASE 
            WHEN m.time_diff_sec <= 300 THEN 0.95
            WHEN m.time_diff_sec <= 1800 THEN 0.85
            ELSE 0.70
        END::NUMERIC as confidence_score,
        CASE 
            WHEN m.time_diff_sec <= 300 THEN 
                'Совпадение последних 7 цифр, звонок через ' || ROUND(m.time_diff_sec) || ' сек после события'
            WHEN m.time_diff_sec <= 1800 THEN 
                'Совпадение последних 7 цифр, звонок через ' || ROUND(m.time_diff_sec / 60) || ' мин после события'
            ELSE 
                'Совпадение последних 7 цифр номера'
        END::TEXT as explanation,
        jsonb_build_object(
            'phone_match', m.phone_match,
            'partial_phone_match', m.phone_match,
            'time_diff_sec', m.time_diff_sec,
            'manager_match', false,
            'direction', m.direction
        ) as matching_factors
    FROM matches m
    WHERE m.phone_match = true
    ORDER BY m.telphin_call_id, confidence_score DESC;
END;
$$;

-- Комментарий для функции
COMMENT ON FUNCTION test_match_calls_to_orders IS 
'Тестовая функция для матчинга звонков с заказами. Делает все в SQL вместо множества запросов из Node.js.';
