-- ============================================================================
-- Заказ должен попадать РОВНО В ОДИН месяц ЗП — по событию «изменение статуса»
-- (переход в p_closing в истории), а не по ручной customField-дате «передачи в
-- производство».
--
-- Баг: прежняя версия определяла период по ОБЪЕДИНЕНИЮ трёх сигналов, каждый из
-- которых фильтровался периодом НЕЗАВИСИМО (история / customField-дата / текущий
-- статус). Когда сигналы попадают в разные месяцы (напр. смена статуса 30.06, а
-- менеджер вручную проставил «дата передачи в производство» 01.07), заказ
-- засчитывался ДВАЖДЫ — и в июне (по истории), и в июле (по customField). Двойная
-- оплата одного заказа.
--
-- Лечим: канон-дата считается ОДИН раз на заказ (по всему времени, без нарезки
-- периодом) с приоритетом «история → customField → текущий статус», а период
-- назначается ОДНОЙ отсечкой по ней. Событие изменения статуса (история) —
-- authoritative; customField/текущий статус остаются только фолбэком, когда
-- истории нет (отставание синка). Так заказ попадает ровно в один месяц.
--
-- Семантика выдачи (колонки, client_id/client_name/site) — как в
-- 20260701_salary_vat_by_site.sql; меняется только правило назначения периода.
-- CREATE OR REPLACE достаточно: OUT-параметры не меняются.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text)
 RETURNS TABLE(order_id bigint, manager_id bigint, client_id bigint, client_name text, entered_at timestamp with time zone, totalsumm numeric, order_method text, typ_castomer text, created_at timestamp with time zone, site text, items jsonb)
 LANGUAGE sql
 STABLE
AS $function$
    WITH hist AS (
        -- authoritative: дата перехода в p_closing по истории. По ВСЕМУ времени
        -- (не режем периодом) — период назначается один раз ниже по канон-дате.
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    cf AS (
        -- фолбэк: ручная customField-дата передачи в производство (по всему времени).
        SELECT o.order_id AS oid,
               to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') AS d
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^\d{4}-\d{2}-\d{2}$'
    ),
    stat AS (
        -- фолбэк: заказ сейчас в p_closing (по всему времени).
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
        -- ОДНА каноническая дата на заказ: событие изменения статуса (история) →
        -- customField → текущий статус. Период — одна отсечка по ней ⇒ заказ
        -- попадает ровно в один месяц (нет двойного счёта на границе месяца).
        SELECT i.oid, COALESCE(h.d, c.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN cf c ON c.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    )
    SELECT o.order_id, o.manager_id,
           COALESCE(
               CASE WHEN o.raw_payload->'customer'->>'id' ~ '^\d+$'
                    THEN (o.raw_payload->'customer'->>'id')::bigint END,
               o.client_id
           ) AS client_id,
           COALESCE(
               NULLIF(trim(o.raw_payload->'customer'->>'nickName'), ''),
               NULLIF(trim(concat_ws(' ', o.raw_payload->'customer'->>'firstName', o.raw_payload->'customer'->>'lastName')), ''),
               NULLIF(trim(concat_ws(' ', o.raw_payload->'contact'->>'firstName', o.raw_payload->'contact'->>'lastName')), '')
           ) AS client_name,
           c.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.site AS site,
           o.raw_payload->'items' AS items
    FROM canon c
    JOIN public.orders o ON o.order_id = c.oid
    WHERE c.entered_at >= p_start AND c.entered_at < p_end;
$function$;
