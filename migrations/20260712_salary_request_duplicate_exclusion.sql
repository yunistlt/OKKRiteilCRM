-- ============================================================================
-- Правило «Дубль заявки» (email + бот дубли). Менеджерам запрещено сливать заказы;
-- дубль переводится в статус-дубль с указанием номера заказа-эталона и причины.
-- Такой заказ ИСКЛЮЧАЕТСЯ из ЧИСЛИТЕЛЯ и ЗНАМЕНАТЕЛЯ конверсии, только если:
--   1) статус = p_req_status (dubliu-zaiavki);
--   2) в комментарии указан номер СУЩЕСТВУЮЩЕГО заказа-эталона («дубль 53686»);
--   3) в комментарии есть пояснительный текст (причина) — слово из ≥3 букв помимо
--      самого «дубль NNNN».
-- Без совпадения суммы и статуса эталона (в отличие от тендерного правила).
-- Коды/логика зеркалят lib/salary/tender-duplicates.ts (evaluateRequestDuplicate).
-- Аддитивно: новый ключ конфига + два параметра p_req_status (DEFAULT NULL — при
-- отсутствии правило не применяется, старые вызовы не ломаются).
-- ============================================================================

-- 1. Сид конфига (effective с начала времён; без хардкода — код статуса в БД)
INSERT INTO salary_config (key, value, effective_from, note, created_by)
VALUES (
  'request_duplicate_rule',
  '{"duplicate_status": "dubliu-zaiavki"}'::jsonb,
  '2020-01-01',
  'Правило исключения «Дубль заявки» из конверсии (числитель и знаменатель)',
  'migration'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- 2. Знаменатель конверсии: + исключение правомочных «Дубль заявки».
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[]);
CREATE OR REPLACE FUNCTION public.salary_incoming_counts(
    p_start timestamptz,
    p_end timestamptz,
    p_exclusions text[],
    p_dup_status text DEFAULT NULL,
    p_ref_statuses text[] DEFAULT NULL,
    p_req_status text DEFAULT NULL
)
RETURNS TABLE(manager_id bigint, incoming bigint)
LANGUAGE sql STABLE AS $$
    SELECT o.manager_id, count(*)
    FROM public.orders o
    WHERE o.created_at >= p_start AND o.created_at < p_end
      AND COALESCE(o.raw_payload->>'orderMethod', '') <> ALL(p_exclusions)
      -- Исключение 1: правомочный дубль на тендер (номер эталона + совпадение суммы + статус эталона)
      AND NOT (
          p_dup_status IS NOT NULL
          AND p_ref_statuses IS NOT NULL
          AND o.status = p_dup_status
          AND EXISTS (
              SELECT 1
              FROM public.orders r
              WHERE r.number = (
                        regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i')
                    )[1]
                AND r.status = ANY(p_ref_statuses)
                AND (
                    SELECT COALESCE(SUM(COALESCE((it->>'initialPrice')::numeric, 0)
                                      * COALESCE((it->>'quantity')::numeric, 0)), 0)
                    FROM jsonb_array_elements(COALESCE(r.raw_payload->'items', '[]'::jsonb)) it
                ) = (
                    SELECT COALESCE(SUM(COALESCE((it->>'initialPrice')::numeric, 0)
                                      * COALESCE((it->>'quantity')::numeric, 0)), 0)
                    FROM jsonb_array_elements(COALESCE(o.raw_payload->'items', '[]'::jsonb)) it
                )
          )
      )
      -- Исключение 2: правомочный «Дубль заявки» (номер существующего эталона + причина)
      AND NOT (
          p_req_status IS NOT NULL
          AND o.status = p_req_status
          AND regexp_replace(COALESCE(o.raw_payload->>'managerComment', ''),
                             '(?:дубль|дубл|dubl)\D*\d{3,6}', ' ', 'gi') ~ '[A-Za-zА-Яа-яЁё]{3,}'
          AND EXISTS (
              SELECT 1 FROM public.orders r
              WHERE r.number = (
                  regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i')
              )[1]
          )
      )
    GROUP BY o.manager_id;
$$;

-- 3. Числитель конверсии (и premia/выручка): + исключение правомочных «Дубль заявки».
--    База — 20260701_salary_counted_orders_single_period.sql (канон-дата, один месяц).
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text);
CREATE OR REPLACE FUNCTION public.salary_counted_orders(
    p_start timestamp with time zone,
    p_end timestamp with time zone,
    p_closing text,
    p_req_status text DEFAULT NULL
)
 RETURNS TABLE(order_id bigint, manager_id bigint, client_id bigint, client_name text, entered_at timestamp with time zone, totalsumm numeric, order_method text, typ_castomer text, created_at timestamp with time zone, site text, items jsonb)
 LANGUAGE sql
 STABLE
AS $function$
    WITH hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        GROUP BY h.retailcrm_order_id
    ),
    cf AS (
        SELECT o.order_id AS oid,
               to_timestamp(o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo', 'YYYY-MM-DD') AS d
        FROM public.orders o
        WHERE o.raw_payload->'customFields'->>'data_peredachi_zakaza_v_proizvodstvo' ~ '^\d{4}-\d{2}-\d{2}$'
    ),
    stat AS (
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
    WHERE c.entered_at >= p_start AND c.entered_at < p_end
      -- Исключаем правомочный «Дубль заявки» и из числителя/премии (редкий случай:
      -- заказ дошёл до производства, затем переведён в дубль).
      AND NOT (
          p_req_status IS NOT NULL
          AND o.status = p_req_status
          AND regexp_replace(COALESCE(o.raw_payload->>'managerComment', ''),
                             '(?:дубль|дубл|dubl)\D*\d{3,6}', ' ', 'gi') ~ '[A-Za-zА-Яа-яЁё]{3,}'
          AND EXISTS (
              SELECT 1 FROM public.orders r
              WHERE r.number = (
                  regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i')
              )[1]
          )
      );
$function$;
