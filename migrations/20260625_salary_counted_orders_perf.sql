-- ============================================================================
-- Перф: расчёт ЗП за период упирался в statement_timeout (симулятор ФОТ, recalc).
-- Узкие места (предсуществующие, не связаны с логикой):
--   1) salary_counted_orders / CTE cf — скан всех orders с to_timestamp() по
--      JSON-полю data_peredachi_zakaza_v_proizvodstvo без индекса (~6.5с).
--   2) salary_client_deal_counts — «status OR EXISTS(history)» прогоняет
--      коррелированный EXISTS по каждому заказу (~6с).
-- Лечим индексами + эквивалентными перезаписями. Семантика результата НЕ
-- меняется (проверено сравнением выдачи до/после на реальных данных).
-- ============================================================================

-- Индекс под текстовый префильтр даты передачи в производство (значения 'YYYY-MM-DD').
CREATE INDEX IF NOT EXISTS idx_orders_data_peredachi
    ON public.orders ((raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo'));

-- Индекс под фильтр по текущему статусу (cf/stat/client_deal).
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);

-- Триграммный GIN под LIKE '%"code":"<status>"%' по order_history_log.new_value.
-- Критично для salary_client_deal_counts: там нет фильтра по дате (сделки клиента
-- за всё время), поэтому без индекса LIKE сканирует все ~555k строк истории. Особенно
-- важно под GENERIC PLAN (PostgREST переиспользует prepared statements): без индекса
-- ~5.2с → с индексом ~1.2с, иначе расчёт упирается в statement_timeout=8s.
-- ВНИМАНИЕ: сборка индекса на 555k строк ~23с с кратковременной блокировкой записи
-- в order_history_log (выполнять в окно низкой активности синка).
CREATE INDEX IF NOT EXISTS idx_order_history_new_value_trgm
    ON public.order_history_log USING gin (new_value gin_trgm_ops);

-- ── salary_counted_orders: cf теперь сначала режет по индексируемому текстовому
--    диапазону даты (с буфером ±2 дня от границ периода, чтобы не потерять
--    пограничные строки из-за таймзоны to_timestamp), затем ТОЧНО уточняет тем же
--    to_timestamp-условием, что и раньше → семантика идентична, скан исчезает.
CREATE OR REPLACE FUNCTION public.salary_counted_orders(p_start timestamptz, p_end timestamptz, p_closing text)
RETURNS TABLE(order_id bigint, manager_id bigint, client_id bigint, client_name text, entered_at timestamptz, totalsumm numeric, order_method text, typ_castomer text, created_at timestamptz, items jsonb)
LANGUAGE sql STABLE AS $function$
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
          -- индексируемый префильтр (буфер ±2 дня), затем точное условие как раньше
          AND o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo'
              >= to_char(p_start - interval '2 days', 'YYYY-MM-DD')
          AND o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo'
              <  to_char(p_end + interval '2 days', 'YYYY-MM-DD')
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') >= p_start
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') <  p_end
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
           COALESCE(
               NULLIF(trim(o.raw_payload->'customer'->>'nickName'), ''),
               NULLIF(trim(concat_ws(' ', o.raw_payload->'customer'->>'firstName', o.raw_payload->'customer'->>'lastName')), ''),
               NULLIF(trim(concat_ws(' ', o.raw_payload->'contact'->>'firstName', o.raw_payload->'contact'->>'lastName')), '')
           ) AS client_name,
           b.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.raw_payload->'items' AS items
    FROM best b
    JOIN public.orders o ON o.order_id = b.oid;
$function$;

-- ── salary_client_deal_counts: «status OR EXISTS» → UNION двух дешёвых веток.
--    Результат идентичен (множество (order_id, cid) то же), но без коррелированного
--    EXISTS по каждому из 29k заказов.
CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(p_client_ids bigint[], p_closing text)
RETURNS TABLE(client_id bigint, deals bigint)
LANGUAGE sql STABLE AS $function$
    WITH client_orders AS (
        SELECT o.order_id,
               COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               ) AS cid
        FROM public.orders o
        WHERE o.status = p_closing
        UNION
        SELECT o.order_id,
               COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               ) AS cid
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
