-- ============================================================================
-- Вечерний отчёт бота считал выручку месяца не так, как ведомость ЗП, и цифры
-- расходились (31.08.2026: бот 11 769 763 ₽ против 10 782 875 ₽ в ведомости).
-- Две причины:
--   1) НДС. Бот суммировал orders.totalsumm (С НДС), ведомость и план отдела —
--      выручка БЕЗ НДС. На августе это 512 838 ₽ разницы.
--   2) Повторный переход в производство. CTE ev был ограничен текущим месяцем,
--      поэтому min(occurred_at) давал не ПЕРВЫЙ переход, а первый в этом месяце.
--      Заказ 53338 ушёл в производство 13.07, был откачен и снова передан 01.08 —
--      и попал в выручку и июля, и августа (474 049 ₽ дважды).
-- Правки: первый переход ищем по всей истории, а выручку считаем общей функцией
-- salary_revenue_no_vat (тот же конфиг salary_config, что и у движка ЗП).
-- ============================================================================

-- Выручка заказа без НДС по конфигу ЗП на дату. Ставка — по витрине-юрлицу и
-- контрагенту (экспортный счёт выставляется без НДС), НЕ по ставке из карточки
-- позиции: её массово не проставляют. Зеркало resolveVatPct/computeOrderFinance
-- из lib/salary/metrics.ts — при правке одного меняй и второе.
CREATE OR REPLACE FUNCTION public.salary_revenue_no_vat(
    p_items jsonb,
    p_site text,
    p_contragent jsonb,
    p_asof date
)
RETURNS numeric
LANGUAGE sql STABLE AS $function$
    WITH policy AS (
        SELECT sc.value AS v FROM public.salary_config sc
        WHERE sc.key = 'vat_policy' AND sc.effective_from <= p_asof
        ORDER BY sc.effective_from DESC LIMIT 1
    ),
    rules AS (
        SELECT sc.value->'rules' AS v FROM public.salary_config sc
        WHERE sc.key = 'nds_normalization' AND sc.effective_from <= p_asof
        ORDER BY sc.effective_from DESC LIMIT 1
    ),
    -- Реквизиты контрагента одной строкой — в них ищем маркеры страны.
    hay AS (
        SELECT lower(concat_ws(' ',
            p_contragent->>'legalName', p_contragent->>'legalAddress',
            p_contragent->>'bank', p_contragent->>'bankAddress',
            p_contragent->>'INN', p_contragent->>'BIK')) AS s
    ),
    vat AS (
        SELECT CASE
            WHEN p_site IS NOT NULL AND EXISTS (
                SELECT 1 FROM policy, jsonb_array_elements_text(policy.v->'exempt_sites') es
                WHERE es = p_site
            ) THEN 0
            -- Маркер ищем по границам слова, иначе «МАЙМИНСКИЙ» читается как
            -- «Минск», а «Лунная» — как «УНН».
            WHEN EXISTS (
                SELECT 1 FROM policy, hay,
                     jsonb_array_elements_text(COALESCE(policy.v->'exempt_contragent_markers', '[]'::jsonb)) m
                WHERE hay.s ~ ('(^|[^[:alnum:]])' || lower(m) || '([^[:alnum:]]|$)')
            ) THEN 0
            ELSE COALESCE((SELECT (policy.v->>'default_vat_pct')::numeric FROM policy), 0)
        END AS pct
    ),
    divisor AS (
        SELECT COALESCE((
            SELECT (r->>'divisor')::numeric
            FROM rules, jsonb_array_elements(rules.v) r, vat
            WHERE (r->>'vat_pct')::numeric = vat.pct
            LIMIT 1
        ), 1) AS d
    )
    SELECT COALESCE(SUM(
        COALESCE((it->'prices'->0->>'price')::numeric, (it->>'initialPrice')::numeric, 0)
        * COALESCE((it->>'quantity')::numeric, 1)
    ), 0) / (SELECT d FROM divisor)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) it;
$function$;

-- Цифры дня для шапки вечернего отчёта: суммы БЕЗ НДС (как план отдела и
-- ведомость ЗП), продажа засчитывается по ПЕРВОМУ переходу в производство.
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
    rev AS (
        SELECT o.order_id,
               public.salary_revenue_no_vat(o.raw_payload->'items', o.site,
                                            o.raw_payload->'contragent', p_date) AS no_vat
          FROM public.orders o
    )
    SELECT
        (SELECT count(*) FROM bills b WHERE b.at >= p_date::timestamptz AND b.at < (p_date + 1)::timestamptz),
        coalesce((SELECT sum(r.no_vat) FROM bills b JOIN rev r ON r.order_id = b.retailcrm_order_id
                   WHERE b.at >= p_date::timestamptz AND b.at < (p_date + 1)::timestamptz), 0),
        (SELECT count(*) FROM sales s WHERE s.at >= p_date::timestamptz AND s.at < (p_date + 1)::timestamptz),
        coalesce((SELECT sum(r.no_vat) FROM sales s JOIN rev r ON r.order_id = s.retailcrm_order_id
                   WHERE s.at >= p_date::timestamptz AND s.at < (p_date + 1)::timestamptz), 0),
        coalesce((SELECT sum(r.no_vat) FROM sales s JOIN rev r ON r.order_id = s.retailcrm_order_id
                   WHERE s.at >= date_trunc('month', p_date::timestamptz)
                     AND s.at < (date_trunc('month', p_date::timestamptz) + interval '1 month')), 0);
$function$;

GRANT EXECUTE ON FUNCTION public.salary_revenue_no_vat(jsonb, text, jsonb, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_rop_day_facts(date) TO service_role;
