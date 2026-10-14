-- ============================================================================
-- Расчёт зарплаты читает покупателя и дату статуса из полей, а не из снимка.
--
-- Повод 14.10.2026: «Зарплата ОП» перестала открываться — расчёт открытого
-- периода не укладывался в лимит. Замер: `salary_client_purchase_ordinals` —
-- 18 секунд, и две трети этого времени база читала `orders.raw_payload` по
-- одному заказу: 8 041 раз ради идентификатора покупателя и ещё раз ради даты
-- смены статуса. Снимок заказа тяжёлый, такое чтение дороже всей остальной
-- работы.
--
-- Берём `orders.customer_id` и `orders."statusUpdatedAt"` — свои поля этих
-- значений (закон об одном источнике правды: снимок — история, не рабочее
-- значение).
--
-- Сверка перед правкой: по идентификатору покупателя расхождений со снимком
-- ноль на всех 38 515 заказах. По дате статуса расходятся 12 заказов — все
-- свои, у них снимок застыл на 29.09.2026, когда перенос отключили, а колонка
-- живая. То есть колонка и есть правда.
--
-- Смысл расчёта не меняется — только источник тех же значений.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.salary_client_purchase_ordinals(
    p_start timestamptz,
    p_end timestamptz,
    p_closing text,
    p_deal_statuses text[] DEFAULT NULL
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
        SELECT o.order_id AS oid, o."statusUpdatedAt" AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o."statusUpdatedAt" IS NOT NULL
    ),
    -- Заказы, чей текущий статус — состоявшаяся сделка (deal_statuses), но записи
    -- входа в closing_status нет ни в истории, ни в текущем статусе.
    deal_orders AS MATERIALIZED (
        SELECT o.order_id AS oid, o."statusUpdatedAt" AS status_d
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
               public.salary_canon_client(COALESCE(o.customer_id, o.client_id)) AS cid,
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

CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(
    p_client_ids bigint[],
    p_closing text,
    p_deal_statuses text[] DEFAULT NULL
)
RETURNS TABLE(client_id bigint, deals bigint)
LANGUAGE sql
STABLE
AS $function$
    WITH client_orders AS (
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(o.customer_id, o.client_id)) AS cid
        FROM public.orders o
        WHERE o.status = p_closing
           OR (p_deal_statuses IS NOT NULL AND o.status = ANY(p_deal_statuses))
        UNION
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(o.customer_id, o.client_id)) AS cid
        FROM public.order_history_log h
        JOIN public.orders o ON o.order_id = h.retailcrm_order_id
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
    )
    SELECT cid AS client_id, count(DISTINCT order_id) AS deals
    FROM client_orders
    WHERE cid = ANY(p_client_ids)
    GROUP BY cid;
$function$;
