-- Агрегатор заказов для консультанта «Семён» (инструмент orders_aggregate), режим «по созданию/статусу».
-- Считает количество, сумму, средний/мин/макс чек (orders.totalsumm) с фильтрами по статусам,
-- периоду СОЗДАНИЯ заказа (created_at) и менеджеру.
-- Режим «успешные / переданные в производство за период» инструмент считает НЕ здесь, а через
-- готовую salary_counted_orders(start, end, closing) — она берёт дату перехода в закрывающий статус
-- из order_history_log (авторитетно), что и есть бизнес-смысл «заказ ушёл в производство = успех».
-- Корректный AVG/SUM на стороне БД (TS-агрегация по выборке рискует упереться в лимит строк PostgREST).
-- Аддитивно: только функция okk_orders_aggregate, существующие объекты не трогаем.

CREATE OR REPLACE FUNCTION okk_orders_aggregate(
    p_status_codes text[]      DEFAULT NULL,
    p_date_from    timestamptz DEFAULT NULL,
    p_date_to      timestamptz DEFAULT NULL,
    p_manager_id   bigint      DEFAULT NULL
)
RETURNS TABLE (
    order_count bigint,
    total_sum   numeric,
    avg_check   numeric,
    min_check   numeric,
    max_check   numeric
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        count(*)::bigint                   AS order_count,
        COALESCE(sum(totalsumm), 0)        AS total_sum,
        COALESCE(round(avg(totalsumm)), 0) AS avg_check,
        COALESCE(min(totalsumm), 0)        AS min_check,
        COALESCE(max(totalsumm), 0)        AS max_check
    FROM orders
    WHERE (p_status_codes IS NULL OR status = ANY(p_status_codes))
      AND (p_date_from IS NULL OR created_at >= p_date_from)
      AND (p_date_to   IS NULL OR created_at <= p_date_to)
      AND (p_manager_id IS NULL OR manager_id = p_manager_id);
$$;
