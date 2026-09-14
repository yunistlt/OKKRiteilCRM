-- ============================================================================
-- Номер покупки клиента (блок «Доплата за повторную покупку») считаем по тем же
-- статусам сделки, что и счётчик «новый/постоянный» (salary_config.deal_statuses).
--
-- Причина: два счётчика расходились. salary_client_deal_counts с 01.09.2026
-- засчитывает заказ с текущим статусом из deal_statuses (отгружен/выполнен…), а
-- salary_client_purchase_ordinals по-прежнему требовал запись входа в closing_status
-- в order_history_log. У заказов 2020–2024 такой записи часто нет (история залита
-- не на всю глубину), поэтому ведомость показывала «2 сделки», а доплата за 2-ю
-- покупку не начислялась (инцидент 54480, ООО «РБК»: 42519 прошёл
-- delivering → otgruzen мимо send-assembling → 54480 считался 1-й покупкой).
--
-- Дата покупки для нумерации: вход в closing_status (история или statusUpdatedAt),
-- а если его нет — самая ранняя запись любого статуса из deal_statuses, иначе
-- statusUpdatedAt текущего статуса. Период фильтруется по той же дате.
-- Аддитивно: новый параметр p_deal_statuses DEFAULT NULL — без него поведение прежнее.
-- ============================================================================

DROP FUNCTION IF EXISTS public.salary_client_purchase_ordinals(timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.salary_client_purchase_ordinals(
    p_start timestamp with time zone,
    p_end timestamp with time zone,
    p_closing text,
    p_deal_statuses text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(order_id bigint, client_id bigint, ordinal bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ),
    -- Заказы, чей текущий статус — состоявшаяся сделка (deal_statuses), но записи
    -- входа в closing_status нет ни в истории, ни в текущем статусе. Сужаем до них
    -- заранее: полный скан истории по всем сделкам не укладывается в лимит REST (8 с).
    deal_orders AS (
        SELECT o.order_id AS oid,
               CASE WHEN o.raw_payload->>'statusUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                    THEN (o.raw_payload->>'statusUpdatedAt')::timestamptz END AS status_d
        FROM public.orders o
        WHERE p_deal_statuses IS NOT NULL
          AND o.status = ANY(p_deal_statuses)
          AND o.status <> p_closing
          AND NOT EXISTS (SELECT 1 FROM hist h WHERE h.oid = o.order_id)
    ),
    -- Дата такой покупки — первая запись любого статуса сделки в истории.
    deal_hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        JOIN deal_orders d ON d.oid = h.retailcrm_order_id
        WHERE h.field = 'status'
          -- В истории два формата: {"code":"x"} и {"code": "x"} — вынимаем код регуляркой.
          AND substring(h.new_value from '"code":\s*"([^"]+)"') = ANY(p_deal_statuses)
        GROUP BY h.retailcrm_order_id
    ),
    deal AS (
        SELECT d.oid, COALESCE(dh.d, d.status_d) AS d
        FROM deal_orders d
        LEFT JOIN deal_hist dh ON dh.oid = d.oid
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM stat
        UNION SELECT oid FROM deal
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, s.d, dl.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
        LEFT JOIN deal dl ON dl.oid = i.oid
    ),
    purchases AS (
        SELECT c.oid,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid,
               c.entered_at
        FROM canon c
        JOIN public.orders o ON o.order_id = c.oid
        WHERE c.entered_at IS NOT NULL
    ),
    ranked AS (
        -- Тай-брейк по oid: две покупки одной секундой должны нумероваться
        -- детерминированно, иначе доплата «прыгает» между заказами при пересчёте.
        SELECT p.oid, p.cid, p.entered_at,
               row_number() OVER (PARTITION BY p.cid ORDER BY p.entered_at, p.oid) AS rn
        FROM purchases p
        WHERE p.cid IS NOT NULL
    )
    SELECT r.oid, r.cid, r.rn
    FROM ranked r
    WHERE r.entered_at >= p_start AND r.entered_at < p_end;
$function$;
