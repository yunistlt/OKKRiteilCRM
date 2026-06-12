-- ============================================================================
-- Зарплатный модуль: определение клиента (новый/постоянный) НЕ зависит от
-- колонки orders.client_id. Колонка не поддерживается синком (см. откат
-- 20260210_rollback_linking.sql — upsert_orders_v2 её не заполняет), поэтому у
-- большинства заказов она NULL, и классификация всегда давала «Новый».
--
-- Канонический идентификатор клиента берём из raw_payload->customer->id
-- (для customer_corporate это компания — верная единица повторных покупок),
-- с фолбэком на старую колонку. Историю сделок считаем по тому же ключу и
-- учитываем как историю статусов, так и текущий статус закрытия (история
-- может отставать при сбое синка).
--
-- Сигнатуры функций не меняются — TS-слой (lib/salary/metrics.ts) не трогаем.
-- ============================================================================

-- Засчитанные заявки периода: client_id из payload (фолбэк на колонку).
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
    SELECT o.order_id, o.manager_id,
           COALESCE(
               CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                    THEN (o.raw_payload->'customer'->>'id')::bigint END,
               o.client_id
           ) AS client_id,
           b.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.raw_payload->'items' AS items
    FROM best b
    JOIN public.orders o ON o.order_id = b.oid;
$$;

-- Сколько заказов клиента КОГДА-ЛИБО доходили до статуса закрытия (за всё время),
-- ключ — payload customer.id (фолбэк на колонку). Учитываем историю статусов ИЛИ
-- текущий статус = закрытие. Для классификации новый/постоянный (> порога = постоянный).
CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(
    p_client_ids bigint[], p_closing text
)
RETURNS TABLE(client_id bigint, deals bigint)
LANGUAGE sql STABLE AS $$
    WITH client_orders AS (
        SELECT o.order_id,
               COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               ) AS cid
        FROM public.orders o
        WHERE o.status = p_closing
           OR EXISTS (
               SELECT 1 FROM public.order_history_log h
               WHERE h.retailcrm_order_id = o.order_id
                 AND h.field = 'status'
                 AND h.new_value LIKE '%"code":"' || p_closing || '"%'
           )
    )
    SELECT cid AS client_id, count(DISTINCT order_id) AS deals
    FROM client_orders
    WHERE cid = ANY(p_client_ids)
    GROUP BY cid;
$$;
