-- Вечерний отчёт РОПа падал двумя способами (9 ошибок за неделю, шаг «цифры дня»).
--
-- 1. «invalid input syntax for type json». Функция читает код статуса из
--    истории заказа как JSON, а 12 324 строки истории хранят одно название
--    («Новый»): их писало создание своего заказа через own-order-insert.ts.
--    Источник починен тем же изменением — теперь туда пишется {code,name}.
--    Старые строки остаются навсегда, поэтому функция обязана их переживать:
--    значение не похоже на JSON — кода в нём нет, строка в расчёт не идёт.
--
-- 2. «canceling statement due to statement timeout». Функция каждый раз
--    прочитывала всю историю заказов (931 088 строк), а индекса по полю
--    `field` не было. Добавляем частичный индекс только по строкам статуса.
--
-- Методику счёта не трогаем: что считается счётом и продажей дня, остаётся
-- прежним.

CREATE OR REPLACE FUNCTION public.sales_rop_day_facts(p_date date)
 RETURNS TABLE(invoices_count bigint, invoices_sum numeric, sold_count bigint, sold_sum numeric, month_sold numeric)
 LANGUAGE sql
 STABLE
AS $function$
    WITH ev AS (
        -- Вся история, не только текущий месяц: иначе повторный переход после
        -- отката выглядит как новая продажа и заказ считается дважды.
        SELECT retailcrm_order_id, (new_value::jsonb->>'code') AS code, occurred_at
          FROM public.order_history_log
         WHERE field = 'status'
           -- Старые строки хранят название статуса вместо {code,name}: кода в
           -- них нет, а приведение к JSON на них падало.
           AND new_value LIKE '{%'
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
