-- Продажи отдела как готовый инструмент Тамары.
--
-- Проверено на живом прогоне дважды: на вопрос «выполним ли план 13 млн» она
-- брала выручку ЗАВОДА из инструментов tseh_*, потому что других готовых цифр у
-- неё не было. Запрет в промпте не помог и не мог: модель берёт то, что лежит
-- под рукой. Значит под рукой должно лежать правильное.
--
-- Продажа здесь — уход заказа в производство. Тот же критерий, по которому
-- считается зарплата отдела: если он разойдётся, продавцы и владелец будут
-- смотреть на разные числа и спорить о них вместо работы.
CREATE OR REPLACE FUNCTION public.sales_month_facts(p_months int DEFAULT 12)
RETURNS TABLE (
    month text,
    sold_count bigint, sold_sum numeric, avg_check numeric,
    invoices_count bigint, invoices_sum numeric
)
LANGUAGE sql STABLE AS $function$
    WITH ev AS (
        SELECT retailcrm_order_id, (new_value::jsonb->>'code') AS code, occurred_at
          FROM public.order_history_log
         WHERE field = 'status'
           AND occurred_at >= date_trunc('month', now()) - make_interval(months => p_months - 1)
    ),
    sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev
         WHERE code IN ('send-assembling', 'zagruzen-systemu') GROUP BY 1
    ),
    bills AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev WHERE code = 'prepayed' GROUP BY 1
    ),
    sold AS (
        SELECT to_char(s.at, 'YYYY-MM') m, count(*) c, sum(o.totalsumm) s, round(avg(o.totalsumm)) a
          FROM sales s JOIN public.orders o ON o.order_id = s.retailcrm_order_id GROUP BY m
    ),
    billed AS (
        SELECT to_char(b.at, 'YYYY-MM') m, count(*) c, sum(o.totalsumm) s
          FROM bills b JOIN public.orders o ON o.order_id = b.retailcrm_order_id GROUP BY m
    )
    SELECT coalesce(sold.m, billed.m),
           coalesce(sold.c, 0), coalesce(sold.s, 0), coalesce(sold.a, 0),
           coalesce(billed.c, 0), coalesce(billed.s, 0)
      FROM sold FULL JOIN billed ON billed.m = sold.m
     ORDER BY 1;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_month_facts(int) TO service_role;

-- Воронка на сейчас: где стоят живые заказы и сколько их по деньгам.
-- Свежесть, а не флаг is_working: тот проставлен даже статусу «Купили в другом
-- месте» и завышает «в работе» в сотни раз.
CREATE OR REPLACE FUNCTION public.sales_pipeline_now(p_days int DEFAULT 45)
RETURNS TABLE (status_name text, orders_count bigint, total_amount numeric, avg_age_days numeric)
LANGUAGE sql STABLE AS $function$
    SELECT s.name::text, count(*), coalesce(sum(o.totalsumm), 0),
           round(avg(EXTRACT(DAY FROM now() - o.updated_at)))
      FROM public.orders o
      JOIN public.statuses s ON s.code = o.status
     WHERE o.status IN ('prepayed','availability','raschet','na-soglasovanii','v-proscete',
                        'otmenili-zakupku-smeta','ozidanie-tz','zapros-kontaktov','tender',
                        'ozhidanie-vykhoda-tendera','otlozeno','novyi-1')
       AND o.updated_at >= now() - make_interval(days => p_days)
     GROUP BY s.name
     ORDER BY 3 DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_pipeline_now(int) TO service_role;
