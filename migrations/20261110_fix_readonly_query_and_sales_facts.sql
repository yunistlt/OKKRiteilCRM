-- Две ошибки в функциях базы, найденные при сборке коннектора Claude (10.11.2026).

-- 1. shtab_run_readonly_query возвращала не ту строку.
--
-- Запрос оборачивался как «SELECT to_jsonb(t) FROM (…) t». Если в самом запросе
-- была колонка с именем t, база понимала to_jsonb(t) как эту колонку, а не как
-- строку целиком, — и вместо строк молча отдавала одно её значение. Запись
-- «имя.*» однозначна при любых именах колонок. Остальное без изменений: только
-- SELECT, один оператор, транзакция без права записи, таймаут 15 секунд.
CREATE OR REPLACE FUNCTION public.shtab_run_readonly_query(p_sql text)
RETURNS SETOF jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    rec jsonb;
BEGIN
    IF p_sql !~* '^\s*(select|with)\s' THEN
        RAISE EXCEPTION 'Разрешён только SELECT';
    END IF;
    IF p_sql ~ ';\s*\S' THEN
        RAISE EXCEPTION 'Разрешён только один оператор';
    END IF;

    PERFORM set_config('transaction_read_only', 'on', true);
    PERFORM set_config('statement_timeout', '15000', true);

    FOR rec IN EXECUTE 'SELECT to_jsonb(shtab_row.*) FROM (' || p_sql || ') shtab_row' LOOP
        RETURN NEXT rec;
    END LOOP;
END;
$function$;

-- 2. sales_month_facts падала целиком: «invalid input syntax for type json».
--
-- Новое значение статуса в истории заказа записано двумя способами: объектом
-- {"code":"…"} и, в 52 строках за октябрь 2026, простым текстом («otlozeno»,
-- «Новый»). Функция приводила к JSON каждую строку, и одной текстовой хватало,
-- чтобы упал весь отчёт. Код статуса теперь читается по тому же правилу, что и в
-- lib/sales-rop/service.ts: объект — берём code, текст — берём как есть.
CREATE OR REPLACE FUNCTION public.sales_month_facts(p_months integer DEFAULT 12)
RETURNS TABLE(month text, sold_count bigint, sold_sum numeric, avg_check numeric, invoices_count bigint, invoices_sum numeric)
LANGUAGE sql
STABLE
AS $function$
    WITH ev AS (
        SELECT retailcrm_order_id,
               CASE WHEN left(ltrim(new_value), 1) = '{'
                    THEN new_value::jsonb->>'code'
                    ELSE btrim(new_value, '" ')
               END AS code,
               occurred_at
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
