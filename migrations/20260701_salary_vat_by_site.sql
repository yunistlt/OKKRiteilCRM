-- Выручка без НДС считается по витрине-юрлицу, а не по ставке из карточки позиции.
-- Менеджеры массово не проставляют НДС (остаётся 0%), из-за чего движок ЗП завышал
-- выручку. Реальное правило: всё, кроме ЗВТО (site = ao-zvto), идёт с НДС 5%; ЗВТО —
-- без НДС. Правило вынесено в конфиг salary_config (vat_policy), без хардкода в коде.
--
-- 1) RPC salary_counted_orders теперь возвращает витрину (orders.site) — по ней
--    слой метрик определяет эффективную ставку НДС. Добавление колонки в RETURNS
--    TABLE требует DROP+CREATE (CREATE OR REPLACE не меняет OUT-параметры).
-- 2) Сеем vat_policy с ранней даты, чтобы getResolvedConfig не падал на пересчёте
--    прошлых периодов (правило действовало всегда; менялась только дисциплина ввода).

DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text);

CREATE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text)
 RETURNS TABLE(order_id bigint, manager_id bigint, client_id bigint, client_name text, entered_at timestamp with time zone, totalsumm numeric, order_method text, typ_castomer text, created_at timestamp with time zone, site text, items jsonb)
 LANGUAGE sql
 STABLE
AS $function$
    WITH hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
          AND h.occurred_at >= p_start AND h.occurred_at < p_end
        GROUP BY h.retailcrm_order_id
    ),
    cf AS (
        SELECT o.order_id AS oid,
               to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') AS d
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^\d{4}-\d{2}-\d{2}$'
          AND o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo'
              >= to_char(p_start - interval '2 days', 'YYYY-MM-DD')
          AND o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo'
              <  to_char(p_end + interval '2 days', 'YYYY-MM-DD')
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') >= p_start
          AND to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') <  p_end
    ),
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}'
          AND (o.raw_payload->>'statusUpdatedAt')::timestamptz >= p_start
          AND (o.raw_payload->>'statusUpdatedAt')::timestamptz < p_end
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM cf
        UNION SELECT oid FROM stat
    ),
    best AS (
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
           b.entered_at, o.totalsumm,
           o.raw_payload->>'orderMethod' AS order_method,
           o.raw_payload->'customFields'->>'typ_castomer' AS typ_castomer,
           o.created_at,
           o.site AS site,
           o.raw_payload->'items' AS items
    FROM best b
    JOIN public.orders o ON o.order_id = b.oid;
$function$;

-- Конфиг правила НДС по витрине. default_vat_pct — ставка для всех витрин по умолчанию;
-- exempt_sites — витрины без НДС (ЗВТО). Делитель берётся из nds_normalization по ставке.
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'vat_policy',
    '{"default_vat_pct": 5, "exempt_sites": ["ao-zvto"]}'::jsonb,
    '2025-01-01',
    'НДС по витрине: все 5%, ЗВТО (ao-zvto) без НДС; ставка из карточки позиции не используется',
    NULL
)
ON CONFLICT (key, effective_from) DO UPDATE
    SET value = EXCLUDED.value, note = EXCLUDED.note;
