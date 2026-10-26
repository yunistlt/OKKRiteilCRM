-- ОДНО правило расчёта денег — в движке зарплаты. В базе второй формулы нет.
--
-- Было: выручку без НДС считали в двух местах — TS (`computeOrderFinance`,
-- движок ЗП) и SQL (`salary_revenue_no_vat`, «зеркало» для бота-РОПа и экрана
-- «Мой день»). 13.10.2026 по жалобе Матвеевой TS научили вычитать скидку на
-- заказ целиком (она видна только в сумме заказа, в позициях её нет), а
-- зеркало не поправили. Итог за октябрь по Матвеевой: «Мой день» 3 761 163 ₽,
-- ведомость 3 456 289 ₽ при ОДНОМ И ТОМ ЖЕ наборе из 18 заказов.
--
-- Стало: функции базы отдают только ОТБОР (какие заказы и когда вошли в
-- статус), деньги считает движок ЗП и кладёт снимком в `salary_calc`. Экраны
-- снимок читают и ничего не пересчитывают.

-- Дневные факты вечернего отчёта: счётчики и списки заказов, без сумм.
-- Суммы по этим спискам считает lib/salary/month-fact.ts.
DROP FUNCTION IF EXISTS public.sales_rop_day_facts(date);

CREATE OR REPLACE FUNCTION public.sales_rop_day_facts(p_date date)
RETURNS TABLE(invoice_ids bigint[], sold_ids bigint[])
LANGUAGE sql STABLE AS $function$
    WITH ev AS (
        SELECT retailcrm_order_id, occurred_at,
               public.sales_rop_status_code(new_value) AS code
          FROM public.order_history_log
         WHERE field = 'status'
    ),
    bills AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev WHERE code = 'prepayed' GROUP BY 1
    ),
    sales AS (
        SELECT retailcrm_order_id, min(occurred_at) at FROM ev
         WHERE code IN ('send-assembling', 'zagruzen-systemu') GROUP BY 1
    )
    SELECT
        coalesce((SELECT array_agg(retailcrm_order_id) FROM bills
                   WHERE at >= p_date::timestamptz AND at < (p_date + 1)::timestamptz), '{}'),
        coalesce((SELECT array_agg(retailcrm_order_id) FROM sales
                   WHERE at >= p_date::timestamptz AND at < (p_date + 1)::timestamptz), '{}');
$function$;

-- Факт месяца по менеджерам больше не считается в базе: он берётся из снимка
-- зарплаты (salary_calc), где менеджер — тот, кто вёл заказ в момент продажи.
DROP FUNCTION IF EXISTS public.sales_rop_month_by_manager(date);

-- Вторая формула выручки. Удаляем последней — после того, как её перестали
-- звать обе функции выше.
DROP FUNCTION IF EXISTS public.salary_revenue_no_vat(jsonb, text, jsonb, date);
