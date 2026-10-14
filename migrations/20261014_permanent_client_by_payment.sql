-- ============================================================================
-- Постоянный клиент — по факту оплаты и по ИНН.
--
-- Решение владельца 14.10.2026: «надо чтобы была оплата обязательно, и мы
-- считаем только по факту оплаты, не важно какой статус; если клиент оплачивал
-- 3 заказа — они считаются постоянными».
--
-- Было два расхождения, оба из жалобы по октябрьской зарплате.
--
-- 1. Покупки считались по СТАТУСУ заказа («передано в производство» и дальше),
--    а не по деньгам. У ООО «Сталкер» выходило 5 покупок там, где оплачено 3.
--
-- 2. Карточки клиентов склеивались транзитивно: карточка, за годы сменившая
--    ИНН, стягивала в одного клиента разные юрлица. Карточка 2699 носит три
--    ИНН — 7327050877, 1655489507 и 166017952539, это три разных лица, и их
--    заказы считались покупками одного клиента. Всего так слито 349 групп,
--    807 ИНН.
--
-- Теперь клиент определяется ИНН контрагента заказа. Заказ без ИНН относится к
-- той же карточке, ЕСЛИ у неё по остальным заказам ИНН ровно один — иначе
-- остаётся сам по себе: угадывать, к какому из нескольких юрлиц он относится,
-- нельзя. Канон группы — наименьший идентификатор карточки в ней, тип прежний.
--
-- Проверка на заказах из жалобы: у «Сталкера» (ИНН 7327050877) оплачены 9999,
-- 17691 и 53666 — ровно три, как и считает владелец. Заказы 33427 и 39895
-- ушли к своим ИНН. У «Промкомплекта» — 51445 и 54932, две покупки.
--
-- Закрытые периоды не трогаются: они хранятся снимком, пересчитывается только
-- открытый.
-- ============================================================================

-- Ключ клиента для зарплаты. Один на все расчёты: иначе «новый/постоянный»,
-- номер покупки и выручка считали бы по разным клиентам.
CREATE OR REPLACE VIEW public.salary_order_client AS
WITH b2 AS (
    SELECT o.order_id,
           o.customer_id,
           CASE WHEN regexp_replace(COALESCE(o.contragent->>'INN', ''), '\D', '', 'g') ~ '^[0-9]{10,12}$'
                THEN regexp_replace(o.contragent->>'INN', '\D', '', 'g') END AS inn
    FROM public.orders o
    WHERE o.customer_id IS NOT NULL
),
-- Единственный ИНН карточки: им закрываем её же заказы, где ИНН не проставлен.
card_inn AS (
    SELECT customer_id, min(inn) AS inn
    FROM b2 WHERE inn IS NOT NULL
    GROUP BY customer_id HAVING count(DISTINCT inn) = 1
),
keyed AS (
    SELECT b2.order_id, b2.customer_id, COALESCE(b2.inn, ci.inn) AS inn
    FROM b2 LEFT JOIN card_inn ci ON ci.customer_id = b2.customer_id
)
-- Ключ клиента — сам ИНН числом, а у кого ИНН нет — идентификатор карточки.
-- Наименьшей карточкой группы ключ быть не может: карточка, носящая несколько
-- ИНН, оказывается наименьшей сразу в нескольких группах и снова стягивает их
-- в одно (проверено на карточке 2699 — трижды наименьшая). Диапазоны не
-- пересекаются: ИНН это 10–12 цифр, карточки — пятизначные номера.
SELECT k.order_id,
       COALESCE(k.inn::bigint, k.customer_id) AS client_key,
       COALESCE('inn:' || k.inn, 'cust:' || k.customer_id) AS group_key
FROM keyed k;

COMMENT ON VIEW public.salary_order_client IS
    'Кто клиент заказа для зарплаты: группа по ИНН контрагента, канон — наименьший идентификатор карточки в группе.';

-- Сколько заказов клиент ОПЛАТИЛ. Статус заказа не имеет значения: покупка —
-- это пришедшие деньги. Параметры p_closing и p_deal_statuses в счёте больше
-- не участвуют, но остаются в сигнатуре: её ждёт расчёт.
CREATE OR REPLACE FUNCTION public.salary_client_deal_counts(
    p_client_ids bigint[],
    p_closing text,
    p_deal_statuses text[] DEFAULT NULL
)
RETURNS TABLE(client_id bigint, deals bigint)
LANGUAGE sql
STABLE
AS $function$
    SELECT k.client_key AS client_id, count(DISTINCT k.order_id) AS deals
    FROM public.salary_order_client k
    JOIN public.orders o ON o.order_id = k.order_id
    WHERE k.client_key = ANY(p_client_ids)
      AND EXISTS (
          SELECT 1 FROM public.order_payments p
           WHERE p.order_id = o.id
             AND p.status IN ('paid', 'check-off-full')
             AND p.amount > 0
      )
    GROUP BY k.client_key;
$function$;

-- Выручка периода: клиент заказа — из общего представления.
CREATE OR REPLACE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text, p_req_status text DEFAULT NULL::text, p_excluded_statuses text[] DEFAULT NULL::text[], p_not_our_statuses text[] DEFAULT NULL::text[], p_not_our_reasons text[] DEFAULT NULL::text[], p_reason_field text DEFAULT NULL::text, p_dup_status text DEFAULT NULL::text, p_ref_statuses text[] DEFAULT NULL::text[], p_dup_reasons text[] DEFAULT NULL::text[], p_est_statuses text[] DEFAULT NULL::text[], p_est_reasons text[] DEFAULT NULL::text[], p_est_patterns text[] DEFAULT NULL::text[], p_est_min_conf numeric DEFAULT NULL::numeric, p_use_history boolean DEFAULT false)
 RETURNS TABLE(order_id bigint, manager_id bigint, client_id bigint, client_name text, entered_at timestamp with time zone, totalsumm numeric, order_method text, typ_castomer text, created_at timestamp with time zone, site text, items jsonb, contragent jsonb)
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
        SELECT o.order_id AS oid, o."statusUpdatedAt" AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o."statusUpdatedAt" IS NOT NULL
          -- Текущий статус берём ТОЛЬКО когда истории статусов по заказу нет
          -- вовсе: тогда дату входа взять больше неоткуда. Есть история —
          -- верим ей.
          --
          -- Разбор 06.10.2026. Без этого условия статус складывался с датой
          -- ЧУЖОГО перехода: заказ 54665 стал «Дублем заявки» 14.09, а
          -- числился переданным в производство — и попадал в сентябрь как
          -- ушедший в производство 14 сентября. Так же 54301 (дата перехода в
          -- «Предоплату» 30.09), 53666 и 54131. Четыре лишние заявки давали
          -- отделу ~900 тыс. ₽ выручки, план «выполнялся» на 100,07 %, и всем
          -- начислялся множитель x1,2.
          AND NOT EXISTS (
              SELECT 1 FROM public.order_history_log h
               WHERE h.retailcrm_order_id = o.order_id
                 AND h.field = 'status'
          )
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
           k.client_key AS client_id,
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
           o.raw_payload->'items' AS items,
           o.raw_payload->'contragent' AS contragent
    FROM canon c
    JOIN public.orders o ON o.order_id = c.oid
    LEFT JOIN public.salary_order_client k ON k.order_id = o.order_id
    WHERE c.entered_at >= p_start AND c.entered_at < p_end
      -- Безусловное исключение спам-статусов
      AND (p_excluded_statuses IS NULL OR NOT (o.status = ANY(p_excluded_statuses)))
      -- Безусловное исключение «не нашей продукции» (симметрично знаменателю).
      -- COALESCE — та же защита от трёхзначной логики, что в salary_incoming_counts.
      AND NOT (
          (
              o.status = ANY(COALESCE(p_not_our_statuses, ARRAY[]::text[]))
              OR COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
                 = ANY(COALESCE(p_not_our_reasons, ARRAY[]::text[]))
          )
          -- «Не наша продукция» — но заказ дошёл до производства и оплачен:
          -- значит, наша. Причина отмены осталась в заказе с прошлой жизни и
          -- её никто не стёр. Жалоба Елены Парфёновой 07.10.2026 по заказу
          -- 54670: 14.09 «у нас нет таких позиций, перепродажа», затем «перевела
          -- на себя наш шкаф», 22.09 оплата 55 212 ₽ и передача в производство —
          -- а в зарплату сентября заказ не попал. Тот же принцип, что у дубля на
          -- тендер ниже: «был» ≠ «навсегда». По всей базе такой заказ один.
          AND NOT (p_closing IS NOT NULL
                   AND public.salary_order_won_production(o.order_id, o.status, p_closing))
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

-- Номер покупки клиента — тоже только по оплаченным заказам.

-- Номер покупки клиента — тоже только по оплаченным заказам.
CREATE OR REPLACE FUNCTION public.salary_client_purchase_ordinals(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text, p_deal_statuses text[] DEFAULT NULL::text[])
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
        SELECT o.order_id AS oid, o."statusUpdatedAt" AS d
        FROM public.orders o
        WHERE o.status = p_closing
          AND o."statusUpdatedAt" IS NOT NULL
    ),
    -- Заказы, чей текущий статус — состоявшаяся сделка (deal_statuses), но записи
    -- входа в closing_status нет ни в истории, ни в текущем статусе.
    deal_orders AS MATERIALIZED (
        SELECT o.order_id AS oid, o."statusUpdatedAt" AS status_d
        FROM public.orders o
        WHERE p_deal_statuses IS NOT NULL
          AND o.status = ANY(p_deal_statuses)
          AND o.status <> p_closing
          AND NOT EXISTS (SELECT 1 FROM hist h WHERE h.oid = o.order_id)
    ),
    -- Дата такой покупки — первая запись любого статуса сделки в истории.
    deal_hist AS (
        SELECT h.retailcrm_order_id AS oid, min(h.occurred_at) AS d
        FROM public.order_history_log h
        JOIN deal_orders d ON d.oid = h.retailcrm_order_id
        WHERE h.field = 'status'
          -- В истории два формата: {"code":"x"} и {"code": "x"} — вынимаем код регуляркой.
          AND substring(h.new_value from '"code":\s*"([^"]+)"') = ANY(p_deal_statuses)
        GROUP BY h.retailcrm_order_id
    ),
    deal AS (
        SELECT d.oid, COALESCE(dh.d, d.status_d) AS d
        FROM deal_orders d
        LEFT JOIN deal_hist dh ON dh.oid = d.oid
    ),
    ids AS (
        SELECT oid FROM hist
        UNION SELECT oid FROM stat
        UNION SELECT oid FROM deal
    ),
    canon AS (
        SELECT i.oid, COALESCE(h.d, s.d, dl.d) AS entered_at
        FROM ids i
        LEFT JOIN hist h ON h.oid = i.oid
        LEFT JOIN stat s ON s.oid = i.oid
        LEFT JOIN deal dl ON dl.oid = i.oid
    ),
    -- Покупка — это пришедшие деньги (решение владельца 14.10.2026). Заказ без
    -- оплаты покупкой не считается и номера не получает, каким бы ни был его
    -- статус. Клиент — из общего представления, по ИНН контрагента.
    purchases AS (
        SELECT c.oid,
               k.client_key AS cid,
               c.entered_at
        FROM canon c
        JOIN public.orders o ON o.order_id = c.oid
        JOIN public.salary_order_client k ON k.order_id = o.order_id
        WHERE c.entered_at IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM public.order_payments p
               WHERE p.order_id = o.id
                 AND p.status IN ('paid', 'check-off-full')
                 AND p.amount > 0
          )
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
