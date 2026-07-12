-- ============================================================================
-- Ускорение salary_engineer_orders: прежняя версия ловила statement timeout —
-- сканировала order_history_log по LIKE трижды по всей истории (566k строк) и
-- извлекала JSONB-поле из всех 29k orders (~4с на raw_payload).
--
-- Лечим двумя приёмами:
--  1) ЭКСПРЕСС-ИНДЕКС по полю инженера — фильтр «есть inzhener_zakaza» идёт по
--     индексу (заказов с полем мало/ноль), а не seq scan всех orders. Индекс
--     ПОЛНЫЙ (не частичный): btree по выражению даёт ANALYZE точную статистику
--     (не-NULL почти нет) → планировщик выбирает Index Scan. С частичным индексом
--     оценка оставалась «≈все строки» и шёл seq scan (~1с). Итог: RPC ~40мс.
--  2) Стартуем ОТ заказов инженера (eng), а дату производства и тайминг расчёта
--     берём ТОЛЬКО по ним через idx_order_history_order_id — без широких сканов
--     истории вообще.
--
-- Поле инженера (inzhener_zakaza) в RPC — литералом (как уже сделано для
-- data_peredachi_zakaza_v_proizvodstvo), иначе параметризованный путь не даст
-- использовать индекс. p_field_code в сигнатуре сохранён (совместимость вызова),
-- фактически равен 'inzhener_zakaza'. CREATE OR REPLACE — сигнатура прежняя.
-- ============================================================================

DROP INDEX IF EXISTS idx_orders_inzhener_zakaza; -- мог существовать как частичный
CREATE INDEX idx_orders_inzhener_zakaza
    ON public.orders ((raw_payload->'customFields'->>'inzhener_zakaza'));
ANALYZE public.orders; -- освежить статистику, чтобы планировщик сразу шёл по индексу

CREATE OR REPLACE FUNCTION public.salary_engineer_orders(
    p_start             timestamp with time zone,
    p_end               timestamp with time zone,
    p_closing           text,
    p_field_code        text,
    p_calc_start_status text,
    p_calc_end_status   text
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
    WITH eng AS (
        -- заказы с проставленным инженером — по частичному индексу (мало строк).
        SELECT o.order_id AS oid,
               NULLIF(trim(o.raw_payload->'customFields'->>'inzhener_zakaza'), '') AS item_code,
               o.totalsumm AS order_sum,
               o.created_at,
               o.status,
               o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' AS cf_date,
               o.raw_payload->>'statusUpdatedAt' AS stat_upd
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'inzhener_zakaza' IS NOT NULL
          AND NULLIF(trim(o.raw_payload->'customFields'->>'inzhener_zakaza'), '') IS NOT NULL
    ),
    prod AS (
        -- дата перехода в производство ТОЛЬКО по eng-заказам (idx_order_history_order_id).
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.retailcrm_order_id IN (SELECT oid FROM eng)
          AND h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    canon AS (
        -- канон-дата: история → customField-дата → текущий статус (приоритет как у менеджеров).
        SELECT e.oid,
               COALESCE(
                   p.d,
                   CASE WHEN e.cf_date ~ '^\d{4}-\d{2}-\d{2}$' THEN to_timestamp(e.cf_date, 'YYYY-MM-DD') END,
                   CASE WHEN e.status = p_closing AND e.stat_upd ~ '^\d{4}-\d{2}-\d{2}' THEN e.stat_upd::timestamptz END
               ) AS entered_at
        FROM eng e
        LEFT JOIN prod p ON p.oid = e.oid
    ),
    target AS (
        SELECT e.oid, e.item_code, c.entered_at, e.order_sum, e.created_at
        FROM eng e
        JOIN canon c ON c.oid = e.oid
        WHERE c.entered_at >= p_start AND c.entered_at < p_end
    ),
    rasch_start AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.retailcrm_order_id IN (SELECT oid FROM target)
          AND h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_calc_start_status || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    rasch_end AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.retailcrm_order_id IN (SELECT oid FROM target)
          AND h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_calc_end_status || '"%'
        GROUP BY h.retailcrm_order_id
    )
    SELECT
        t.oid,
        t.item_code,
        t.entered_at,
        t.order_sum,
        CASE
            WHEN rs.d IS NOT NULL AND re.d IS NOT NULL AND re.d >= rs.d
            THEN EXTRACT(EPOCH FROM (re.d - rs.d))
        END AS raschet_seconds,
        t.created_at
    FROM target t
    LEFT JOIN rasch_start rs ON rs.oid = t.oid
    LEFT JOIN rasch_end re ON re.oid = t.oid;
$function$;
