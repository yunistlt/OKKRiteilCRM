-- ============================================================================
-- Устойчивый источник «засчитанных заявок»: НЕ зависит только от order_history_log
-- (который может отставать при сбое синка). Заказ считается «переданным в
-- производство в окне», если выполнен ЛЮБОЙ сигнал:
--   1) переход статуса в p_closing зафиксирован в истории (authoritative),
--   2) заполнена customField-дата передачи в производство в окне,
--   3) заказ СЕЙЧАС в статусе p_closing и statusUpdatedAt в окне.
-- entered_at = самая ранняя доступная дата из сигналов.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.salary_counted_orders(
    p_start timestamptz, p_end timestamptz, p_closing text
)
RETURNS TABLE(
    order_id bigint, manager_id bigint, client_id bigint,
    entered_at timestamptz, totalsumm numeric,
    order_method text, typ_castomer text, created_at timestamptz, items jsonb
)
LANGUAGE sql STABLE AS $$
    WITH hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
          AND h.occurred_at >= p_start AND h.occurred_at < p_end
        GROUP BY h.retailcrm_order_id
    ),
    cf AS (
        SELECT o.order_id AS oid,
               to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') AS d
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^\d{4}-\d{2}-\d{2}$'
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') >= p_start
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') < p_end
    ),
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}'
          AND (o.raw_payload->>'statusUpdatedAt')::timestamptz >= p_start
          AND (o.raw_payload->>'statusUpdatedAt')::timestamptz < p_end
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM cf
        UNION SELECT oid FROM stat
    ),
    best AS (
        -- Приоритет даты: история (authoritative) → customField → текущий статус
        SELECT i.oid, COALESCE(h.d, c.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN cf c ON c.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    )
    SELECT o.order_id, o.manager_id, o.client_id, b.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.raw_payload->'items' AS items
    FROM best b
    JOIN public.orders o ON o.order_id = b.oid;
$$;
