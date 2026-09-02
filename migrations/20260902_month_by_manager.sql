-- Выручка месяца в разрезе менеджера — для личного плана в вечернем отчёте.
--
-- Планы (общий и личные) владелец ставит в «Настройки мотивации → Планы»
-- (salary_plan). Бот до сих пор знал только общий и брал его из собственной
-- настройки month_plan, которая не менялась по месяцам. Теперь и общий, и
-- личный план читаются оттуда же, откуда их берёт ведомость ЗП.
--
-- Считаем ровно как sales_rop_day_facts: продажа засчитывается по ПЕРВОМУ
-- переходу в производство (иначе откат и повторная передача дают двойной счёт),
-- сумма — без НДС общей функцией salary_revenue_no_vat.
CREATE OR REPLACE FUNCTION public.sales_rop_month_by_manager(p_date date)
RETURNS TABLE (manager_id bigint, sold_count bigint, sold_sum numeric)
LANGUAGE sql STABLE AS $function$
    WITH sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at
          FROM public.order_history_log
         WHERE field = 'status'
           AND (new_value::jsonb->>'code') IN ('send-assembling', 'zagruzen-systemu')
         GROUP BY 1
    ),
    month_sales AS (
        SELECT * FROM sales
         WHERE at >= date_trunc('month', p_date::timestamptz)
           AND at < (date_trunc('month', p_date::timestamptz) + interval '1 month')
    )
    SELECT o.manager_id,
           count(*),
           coalesce(sum(public.salary_revenue_no_vat(o.raw_payload->'items', o.site,
                                                     o.raw_payload->'contragent', p_date)), 0)
      FROM month_sales m
      JOIN public.orders o ON o.order_id = m.retailcrm_order_id
     WHERE o.manager_id IS NOT NULL
     GROUP BY o.manager_id;
$function$;

GRANT EXECUTE ON FUNCTION public.sales_rop_month_by_manager(date) TO service_role;
