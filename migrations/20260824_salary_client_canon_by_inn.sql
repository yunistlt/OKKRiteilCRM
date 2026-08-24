-- Склейка дублей карточек клиента для расчёта ЗП.
--
-- Проблема: менеджеры в RetailCRM заводят НОВУЮ карточку клиента почти на каждый
-- заказ. «ООО НПП АММА» — 4 разных customer.id (14336, 66305, 66931, 73852) при
-- одном ИНН 0278166802. Классификация «новый/постоянный» группирует заказы по
-- customer.id, поэтому у постоянного клиента каждый заказ выглядел первым, и
-- менеджеры теряли надбавку. На 2026-08-24: 596 ИНН размазаны по 1433 карточкам.
--
-- Решение: канонический клиент — минимальный customer.id внутри группы.
-- Группа определяется по первому доступному ключу:
--   1) ИНН контрагента (raw_payload->contragent->INN, фолбэк company->contragent->INN)
--   2) id компании (raw_payload->company->id) — когда ИНН не выгружен
--   3) сам customer.id — розница/физлица, склеивать нечего
-- Тип client_id остаётся bigint, сигнатуры RPC не меняются.

CREATE TABLE IF NOT EXISTS public.salary_client_canon (
    cust_id    bigint PRIMARY KEY,
    canon_id   bigint NOT NULL,
    group_key  text   NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_client_canon_canon
    ON public.salary_client_canon (canon_id);

COMMENT ON TABLE public.salary_client_canon IS
    'Дубли карточек RetailCRM → канонический клиент (min customer.id в группе по ИНН/компании). Пересобирается salary_rebuild_client_canon().';

-- Пересборка справочника из orders. Идемпотентна, полный пересчёт.
--
-- Склейка транзитивная (label propagation по графу «карточка — ключ»), а не
-- «один ключ на карточку»: у АО «Химреактивснаб» карточка 17959 несёт два ИНН
-- (0276029920 и 0278969253 — смена юрлица), и новая карточка 73995 цепляется к
-- ней только через второй. Любой общий ключ стягивает карточки в одну группу,
-- канон — минимальный customer.id компоненты.
CREATE OR REPLACE FUNCTION public.salary_rebuild_client_canon()
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
    v_rows    bigint;
    v_changed bigint;
    v_iter    int := 0;
BEGIN
    -- Рёбра графа: карточка ↔ каждый её ключ (ИНН контрагента, id компании).
    CREATE TEMP TABLE _edges ON COMMIT DROP AS
    WITH base AS (
        SELECT
            COALESCE(
                CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                     THEN (o.raw_payload->'customer'->>'id')::bigint END,
                o.client_id
            ) AS cust_id,
            NULLIF(regexp_replace(
                COALESCE(
                    o.raw_payload->'contragent'->>'INN',
                    o.raw_payload->'company'->'contragent'->>'INN',
                    ''
                ), '\D', '', 'g'), '') AS inn,
            NULLIF(o.raw_payload->'company'->>'id', '') AS company_id
        FROM public.orders o
    )
    SELECT DISTINCT cust_id, k AS group_key
    FROM base,
         LATERAL (VALUES
             (CASE WHEN inn ~ '^[0-9]{10,12}$'  THEN 'inn:'  || inn END),
             (CASE WHEN company_id ~ '^[0-9]+$' THEN 'comp:' || company_id END)
         ) AS v(k)
    WHERE cust_id IS NOT NULL AND k IS NOT NULL;

    CREATE INDEX ON _edges (group_key);
    CREATE INDEX ON _edges (cust_id);

    -- Метка карточки = минимальный cust_id её компоненты связности.
    CREATE TEMP TABLE _label ON COMMIT DROP AS
    SELECT DISTINCT
        COALESCE(
            CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                 THEN (o.raw_payload->'customer'->>'id')::bigint END,
            o.client_id
        ) AS cust_id,
        COALESCE(
            CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                 THEN (o.raw_payload->'customer'->>'id')::bigint END,
            o.client_id
        ) AS label
    FROM public.orders o
    WHERE COALESCE(
              CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                   THEN (o.raw_payload->'customer'->>'id')::bigint END,
              o.client_id
          ) IS NOT NULL;

    CREATE UNIQUE INDEX ON _label (cust_id);

    -- Итерации до стабилизации. Компоненты мелкие (единицы карточек), реально
    -- хватает 2–4 проходов; 50 — страховка от зацикливания.
    LOOP
        v_iter := v_iter + 1;

        WITH key_min AS (
            SELECT e.group_key, min(l.label) AS m
            FROM _edges e JOIN _label l USING (cust_id)
            GROUP BY e.group_key
        ),
        cust_min AS (
            SELECT e.cust_id, min(k.m) AS m
            FROM _edges e JOIN key_min k USING (group_key)
            GROUP BY e.cust_id
        )
        UPDATE _label l
        SET label = c.m
        FROM cust_min c
        WHERE c.cust_id = l.cust_id AND c.m < l.label;

        GET DIAGNOSTICS v_changed = ROW_COUNT;
        EXIT WHEN v_changed = 0 OR v_iter >= 50;
    END LOOP;

    INSERT INTO public.salary_client_canon (cust_id, canon_id, group_key, updated_at)
    SELECT l.cust_id, l.label, 'canon:' || l.label::text, now()
    FROM _label l
    ON CONFLICT (cust_id) DO UPDATE
        SET canon_id = EXCLUDED.canon_id,
            group_key = EXCLUDED.group_key,
            updated_at = now()
        WHERE public.salary_client_canon.canon_id IS DISTINCT FROM EXCLUDED.canon_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$function$;

-- Неизвестная карточка отдаёт саму себя — расчёт не ломается до пересборки.
CREATE OR REPLACE FUNCTION public.salary_canon_client(p_cust_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(
        (SELECT c.canon_id FROM public.salary_client_canon c WHERE c.cust_id = p_cust_id),
        p_cust_id
    );
$function$;

SELECT public.salary_rebuild_client_canon();
-- salary_client_deal_counts
CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(p_client_ids bigint[], p_closing text)
 RETURNS TABLE(client_id bigint, deals bigint)
 LANGUAGE sql
 STABLE
AS $function$
    WITH client_orders AS (
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid
        FROM public.orders o
        WHERE o.status = p_closing
        UNION
        SELECT o.order_id,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid
        FROM public.order_history_log h
        JOIN public.orders o ON o.order_id = h.retailcrm_order_id
        WHERE h.field = 'status'
          AND h.new_value LIKE '%"code":"' || p_closing || '"%'
    )
    SELECT cid AS client_id, count(DISTINCT order_id) AS deals
    FROM client_orders
    WHERE cid = ANY(p_client_ids)
    GROUP BY cid;
$function$
;

-- salary_client_purchase_ordinals
CREATE OR REPLACE FUNCTION public.salary_client_purchase_ordinals(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text)
 RETURNS TABLE(order_id bigint, client_id bigint, ordinal bigint)
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
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM stat
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    ),
    purchases AS (
        SELECT c.oid,
               public.salary_canon_client(COALESCE(
                       CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                            THEN (o.raw_payload->'customer'->>'id')::bigint END,
                       o.client_id
                   )) AS cid,
               c.entered_at
        FROM canon c
        JOIN public.orders o ON o.order_id = c.oid
        WHERE c.entered_at IS NOT NULL
    ),
    ranked AS (
        -- Тай-брейк по oid: две покупки одной секундой должны нумероваться
        -- детерминированно, иначе доплата «прыгает» между заказами при пересчёте.
        SELECT p.oid, p.cid, p.entered_at,
               row_number() OVER (PARTITION BY p.cid ORDER BY p.entered_at, p.oid) AS rn
        FROM purchases p
        WHERE p.cid IS NOT NULL
    )
    SELECT r.oid, r.cid, r.rn
    FROM ranked r
    WHERE r.entered_at >= p_start AND r.entered_at < p_end;
$function$
;

-- salary_counted_orders
CREATE OR REPLACE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text, p_req_status text DEFAULT NULL::text, p_excluded_statuses text[] DEFAULT NULL::text[], p_not_our_statuses text[] DEFAULT NULL::text[], p_not_our_reasons text[] DEFAULT NULL::text[], p_reason_field text DEFAULT NULL::text, p_dup_status text DEFAULT NULL::text, p_ref_statuses text[] DEFAULT NULL::text[], p_dup_reasons text[] DEFAULT NULL::text[], p_est_statuses text[] DEFAULT NULL::text[], p_est_reasons text[] DEFAULT NULL::text[], p_est_patterns text[] DEFAULT NULL::text[], p_est_min_conf numeric DEFAULT NULL::numeric, p_use_history boolean DEFAULT false)
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
    stat AS (
        SELECT o.order_id AS oid, (o.raw_payload->>'statusUpdatedAt')::timestamptz AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o.raw_payload->>'statusUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}'
    ),
    -- Предпроизводственные статусы (откат) — из конфига, effective на начало периода.
    regr AS (
        SELECT ARRAY(SELECT jsonb_array_elements_text(sc.value->'preproduction_statuses')) AS codes
        FROM public.salary_config sc
        WHERE sc.key = 'production_regression'
          AND sc.effective_from <= p_start::date
        ORDER BY sc.effective_from DESC
        LIMIT 1
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM stat
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, s.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
    )
    SELECT o.order_id, o.manager_id,
           public.salary_canon_client(COALESCE(
                   CASE WHEN o.raw_payload->'customer'->>'id' ~ '^[0-9]+$'
                        THEN (o.raw_payload->'customer'->>'id')::bigint END,
                   o.client_id
               )) AS client_id,
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
      -- Безусловное исключение спам-статусов
      AND (p_excluded_statuses IS NULL OR NOT (o.status = ANY(p_excluded_statuses)))
      -- Безусловное исключение «не нашей продукции» (симметрично знаменателю).
      -- COALESCE — та же защита от трёхзначной логики, что в salary_incoming_counts.
      AND NOT (
          o.status = ANY(COALESCE(p_not_our_statuses, ARRAY[]::text[]))
          OR COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
             = ANY(COALESCE(p_not_our_reasons, ARRAY[]::text[]))
      )
      -- Исключение «Сметы» — точная копия предиката знаменателя.
      AND NOT (
          o.status = ANY(COALESCE(p_est_statuses, ARRAY[]::text[]))
          AND (
              COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
                  = ANY(COALESCE(p_est_reasons, ARRAY[]::text[]))
              OR (
                  EXISTS (
                      SELECT 1 FROM unnest(COALESCE(p_est_patterns, ARRAY[]::text[])) pat
                      WHERE lower(COALESCE(o.raw_payload->>'managerComment', '') || ' '
                                  || COALESCE(o.raw_payload->>'customerComment', '')) LIKE '%' || pat || '%'
                  )
                  AND EXISTS (
                      SELECT 1 FROM public.order_estimate_verdicts v
                      WHERE v.retailcrm_order_id = o.order_id
                        AND v.is_estimate IS TRUE
                        AND COALESCE(v.confidence, 0) >= COALESCE(p_est_min_conf, 0)
                  )
              )
          )
      )
      -- Откат из производства: текущий статус — предпроизводственный ⇒ не в производстве.
      AND NOT (o.status = ANY(COALESCE((SELECT codes FROM regr), ARRAY[]::text[])))
      -- Исключение правомочного «Дубль заявки» из числителя/премии
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
      -- Исключение правомочного «Дубль на тендер» из числителя/премии: закупку забрал
      -- эталон, дубль премию приносить не должен. Предикат — точная копия знаменателя.
      AND NOT (
          p_dup_status IS NOT NULL
          AND p_ref_statuses IS NOT NULL
          AND (
              o.status = p_dup_status
              OR COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
                 = ANY(COALESCE(p_dup_reasons, ARRAY[]::text[]))
              -- дубль, которого увели из статуса дубля (например в «Согласование
              -- отмены», где причину отмены ещё не проставили), остаётся дублем.
              -- НО «был дублем» ≠ «дубль навсегда»: за июнь–июль 37 заказов
              -- побывали в статусе дубля, и 9 из них ожили — 4 доехали до
              -- производства (53464 на 382 768 ₽, 53760, 53444, 53610), 5 сами
              -- стали тендерами (53681 на 1 366 400 ₽ и др.). Ожившие остаются
              -- полноценными заявками, иначе мы выбросим реальную продажу и из
              -- знаменателя, и из числителя (премии).
              OR (p_use_history
                  AND public.salary_order_was_in_statuses(
                          o.order_id, o.status, ARRAY[p_dup_status])
                  AND NOT (o.status = ANY(COALESCE(p_ref_statuses, ARRAY[]::text[])))
                  AND NOT (p_closing IS NOT NULL
                           AND public.salary_order_won_production(
                                   o.order_id, o.status, p_closing)))
          )
          AND EXISTS (
              SELECT 1
              FROM public.orders r
              WHERE r.number = public.salary_tender_duplicate_root(
                        (regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i'))[1],
                        p_dup_status, p_dup_reasons, p_reason_field, 5, p_use_history
                    )
                AND (
                    r.status = ANY(p_ref_statuses)
                    OR public.salary_order_won_production(r.order_id, r.status, p_closing)
                    OR (p_use_history AND public.salary_order_was_in_statuses(
                           r.order_id, r.status, p_ref_statuses))
                )
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(o.raw_payload->'items', '[]'::jsonb)) oi
                    JOIN jsonb_array_elements(COALESCE(r.raw_payload->'items', '[]'::jsonb)) ri
                      ON COALESCE((ri->>'quantity')::numeric, 0) = COALESCE((oi->>'quantity')::numeric, 0)
                     AND (
                         COALESCE(NULLIF(lower(btrim(ri->'offer'->>'xmlId')), ''), '#ref')
                             = COALESCE(NULLIF(lower(btrim(oi->'offer'->>'xmlId')), ''), '#dup')
                         OR COALESCE(NULLIF(lower(btrim(ri->'offer'->>'article')), ''), '#ref')
                             = COALESCE(NULLIF(lower(btrim(oi->'offer'->>'article')), ''), '#dup')
                         OR COALESCE(NULLIF(lower(btrim(ri->'offer'->>'externalId')), ''), '#ref')
                             = COALESCE(NULLIF(lower(btrim(oi->'offer'->>'externalId')), ''), '#dup')
                     )
                )
          )
      );
$function$
;

