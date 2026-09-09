-- Вечерний отчёт падал по statement timeout: sales_rop_day_facts занимала 14 с.
--
-- Причина въехала вчера вместе с правкой НДС (20260901_sales_rop_month_revenue):
-- CTE rev считал salary_revenue_no_vat — тяжёлый разбор jsonb с позициями и
-- реквизитами — для КАЖДОГО заказа базы, хотя в итог попадают только заказы за
-- сегодня и за текущий месяц. Вчера это отработало впритык, сегодня перешагнуло
-- лимит 8 с, и отчёт не ушёл вовсе.
--
-- Считаем выручку только по нужным заказам. Цифры не меняются: те же заказы,
-- та же функция, тот же конфиг НДС — сужается лишь множество, к которому она
-- применяется.
CREATE OR REPLACE FUNCTION public.sales_rop_day_facts(p_date date)
RETURNS TABLE (
    invoices_count bigint, invoices_sum numeric,
    sold_count bigint, sold_sum numeric, month_sold numeric
)
LANGUAGE sql STABLE AS $function$
    WITH ev AS (
        -- Вся история, не только текущий месяц: иначе повторный переход после
        -- отката выглядит как новая продажа и заказ считается дважды.
        SELECT retailcrm_order_id, (new_value::jsonb->>'code') AS code, occurred_at
          FROM public.order_history_log
         WHERE field = 'status'
    ),
    bills AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev WHERE code = 'prepayed' GROUP BY 1
    ),
    sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev
         WHERE code IN ('send-assembling', 'zagruzen-systemu') GROUP BY 1
    ),
    day_bills AS (
        SELECT * FROM bills WHERE at >= p_date::timestamptz AND at < (p_date + 1)::timestamptz
    ),
    day_sales AS (
        SELECT * FROM sales WHERE at >= p_date::timestamptz AND at < (p_date + 1)::timestamptz
    ),
    month_sales AS (
        SELECT * FROM sales
         WHERE at >= date_trunc('month', p_date::timestamptz)
           AND at < (date_trunc('month', p_date::timestamptz) + interval '1 month')
    ),
    -- Только те заказы, что реально попадают в итог. Раньше здесь была вся
    -- таблица orders, и на каждый её заказ звалась тяжёлая jsonb-функция.
    needed AS (
        SELECT retailcrm_order_id AS id FROM day_bills
        UNION
        SELECT retailcrm_order_id FROM day_sales
        UNION
        SELECT retailcrm_order_id FROM month_sales
    ),
    rev AS (
        SELECT o.order_id,
               public.salary_revenue_no_vat(o.raw_payload->'items', o.site,
                                            o.raw_payload->'contragent', p_date) AS no_vat
          FROM public.orders o
          JOIN needed n ON n.id = o.order_id
    )
    SELECT
        (SELECT count(*) FROM day_bills),
        coalesce((SELECT sum(r.no_vat) FROM day_bills b JOIN rev r ON r.order_id = b.retailcrm_order_id), 0),
        (SELECT count(*) FROM day_sales),
        coalesce((SELECT sum(r.no_vat) FROM day_sales s JOIN rev r ON r.order_id = s.retailcrm_order_id), 0),
        coalesce((SELECT sum(r.no_vat) FROM month_sales s JOIN rev r ON r.order_id = s.retailcrm_order_id), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_day_facts(date) TO service_role;
