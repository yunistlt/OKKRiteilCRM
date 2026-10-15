-- ============================================================================
-- Ведомость ЗП: имя клиента берётся из карточки клиента, номер заказа — из поля
-- номера.
--
-- Жалоба владельца 15.10.2026 по заказам 900042 и 900072: в раскрытии «Новые
-- клиенты» вместо покупателя прочерк, а номер показан как «#900000072» —
-- «странно нумерация идёт, лишние нули».
--
-- Причины разные, обе в этой функции:
--
-- 1. Имя клиента читалось из снимка raw_payload->customer. У заказа, заведённого
--    в ОКК, в customer лежит только {id, type} — имени там нет и не будет.
--    Источник правды по имени — карточка клиента (clients), её и читаем по
--    orders.customer_id. Снимок остаётся ПОСЛЕДНИМ запасом: у 10 490 старых
--    заказов карточки клиента в clients нет вовсе (перенос неполный), и без
--    запаса ведомость за прошлые месяцы осталась бы без имён.
--
-- 2. Номера заказа функция не отдавала вовсе — отчёт показывал внутренний
--    идентификатор. У заказов из RetailCRM он совпадает с номером (35 605 из
--    38 525), поэтому подмены никто не замечал; у своих заказов номер 900072, а
--    идентификатор 900000072. Отдаём orders.number и показываем его.
--
-- Деньги не трогаются: обе колонки — только для отображения.
-- ============================================================================

-- Тип результата меняется (добавилась колонка number) — пересоздаём.
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamp with time zone, timestamp with time zone, text, text, text[], text[], text[], text, text, text[], text[], text[], text[], text[], numeric, boolean);

CREATE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text, p_req_status text DEFAULT NULL::text, p_excluded_statuses text[] DEFAULT NULL::text[], p_not_our_statuses text[] DEFAULT NULL::text[], p_not_our_reasons text[] DEFAULT NULL::text[], p_reason_field text DEFAULT NULL::text, p_dup_status text DEFAULT NULL::text, p_ref_statuses text[] DEFAULT NULL::text[], p_dup_reasons text[] DEFAULT NULL::text[], p_est_statuses text[] DEFAULT NULL::text[], p_est_reasons text[] DEFAULT NULL::text[], p_est_patterns text[] DEFAULT NULL::text[], p_est_min_conf numeric DEFAULT NULL::numeric, p_use_history boolean DEFAULT false)
 RETURNS TABLE(order_id bigint, number text, manager_id bigint, client_id bigint, client_name text, entered_at timestamp with time zone, totalsumm numeric, order_method text, typ_castomer text, created_at timestamp with time zone, site text, items jsonb, contragent jsonb)
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
    SELECT o.order_id, o.number, o.manager_id,
           k.client_key AS client_id,
           -- Имя клиента — из карточки клиента по orders.customer_id. Снимок
           -- заказа в конце списка: он выручает только там, где карточки клиента
           -- в нашей базе ещё нет.
           COALESCE(
               NULLIF(trim(cl.company_name), ''),
               NULLIF(trim(cl."legalName"), ''),
               NULLIF(trim(concat_ws(' ', cl.first_name, cl.last_name)), ''),
               NULLIF(trim(cl.contact_name), ''),
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
    LEFT JOIN public.clients cl ON cl.id = o.customer_id
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
