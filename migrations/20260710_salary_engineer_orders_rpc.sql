-- ============================================================================
-- salary_engineer_orders — заказы, засчитываемые инженеру-расчётчику за период.
--
-- Отличия от salary_counted_orders (менеджеры):
--   • атрибуция по customField p_field_code (`inzhener_zakaza`), НЕ по manager_id;
--   • отдаёт item_code инженера, сумму заказа и raschet_seconds — длительность
--     работы расчётчика (переход в p_calc_start_status → p_calc_end_status).
--
-- Назначение периода — ИДЕНТИЧНО менеджерскому (канон-дата перехода в p_closing
-- = «Передано в производство», приоритет история→customField→текущий статус),
-- чтобы заказ падал инженеру в тот же месяц, что и менеджеру. Ровно один месяц
-- на заказ (см. 20260701_salary_counted_orders_single_period.sql).
--
-- Ноль хардкода: коды статусов и код поля — ПАРАМЕТРЫ (значения из salary_config
-- в TS-слое), а не зашиты в SQL.
--
-- raschet_seconds — КАЛЕНДАРНЫЕ секунды (start→end). Пересчёт по рабочему
-- календарю и обработка повторных заходов — в блоке/TS (фаза 2); здесь сырьё.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.salary_engineer_orders(
    p_start             timestamp with time zone,
    p_end               timestamp with time zone,
    p_closing           text,   -- статус-триггер начисления (send-assembling)
    p_field_code        text,   -- код кастом-поля инженера (inzhener_zakaza)
    p_calc_start_status text,   -- старт таймера расчёта (v-proscete)
    p_calc_end_status   text    -- конец таймера расчёта (na-soglasovanii)
)
 RETURNS TABLE(
    order_id       bigint,
    item_code      text,
    entered_at     timestamp with time zone,
    order_sum      numeric,
    raschet_seconds numeric,
    created_at     timestamp with time zone
 )
 LANGUAGE sql
 STABLE
AS $function$
    WITH hist AS (
        -- authoritative: дата перехода в p_closing по истории (по всему времени).
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    cf AS (
        -- фолбэк: ручная customField-дата передачи в производство.
        SELECT o.order_id AS oid,
               to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') AS d
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^\d{4}-\d{2}-\d{2}$'
    ),
    stat AS (
        -- фолбэк: заказ сейчас в p_closing.
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}'
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM cf
        UNION SELECT oid FROM stat
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, c.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN cf c ON c.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    ),
    rasch_start AS (
        -- первый вход в старт-статус расчёта.
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_calc_start_status || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    rasch_end AS (
        -- первый вход в конец-статус расчёта.
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_calc_end_status || '"%'
        GROUP BY h.retailcrm_order_id
    )
    SELECT
        o.order_id,
        NULLIF(trim(o.raw_payload->'customFields'->>p_field_code), '') AS item_code,
        c.entered_at,
        o.totalsumm AS order_sum,
        CASE
            WHEN rs.d IS NOT NULL AND re.d IS NOT NULL AND re.d >= rs.d
            THEN EXTRACT(EPOCH FROM (re.d - rs.d))
        END AS raschet_seconds,
        o.created_at
    FROM canon c
    JOIN public.orders o ON o.order_id = c.oid
    LEFT JOIN rasch_start rs ON rs.oid = c.oid
    LEFT JOIN rasch_end re ON re.oid = c.oid
    WHERE c.entered_at >= p_start AND c.entered_at < p_end
      AND NULLIF(trim(o.raw_payload->'customFields'->>p_field_code), '') IS NOT NULL;
$function$;
