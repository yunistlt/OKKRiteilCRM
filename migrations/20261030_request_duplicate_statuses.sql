-- ============================================================================
-- «Дубль заявки» снова исключается из конверсии: правило знает ВСЕ коды статуса,
-- а не один.
--
-- Доработка №66, Евгения Матвеева 30.10.2026: «Статус Дубль заявки (недавно
-- добавили для менеджеров) засчитывает заказы в конверсию» — заказы 900312,
-- 900381, 900387.
--
-- Причина. У статуса «Дубль заявки» на доске два кода: старый `dubliu-zaiavki`
-- (RetailCRM, снят с работы, 267 заказов по 02.10.2026) и наш `dubl-zayavki`
-- (с 19.10.2026). Правило `request_duplicate_rule` держало РОВНО ОДИН код —
-- старый, поэтому заказы в новом статусе проходили мимо исключения и падали в
-- знаменатель конверсии. Одним кодом октябрь не закрыть: в нём есть заказы и в
-- старом коде (7), и в новом (11).
--
-- Что меняем: `duplicate_status` (строка) → `duplicate_statuses` (список).
-- Сравнение `o.status = p_req_status` становится `o.status = ANY(p_req_statuses)`,
-- остальное тело функций не тронуто — определения сняты с боевой базы и
-- перенесены как есть. Переименование статуса впредь закрывается настройкой,
-- а не правкой кода.
--
-- Закрытые периоды не едут: до 19.10.2026 заказов в новом коде нет, так что
-- добавление кода в список ничего в них не меняет.
--
-- ПОРЯДОК ВЫКАТКИ. Миграция аддитивная и накатывается ДО кода, не ломая прод:
--   * старые функции (с `p_req_status text`) остаются на месте — выкаченный
--     сейчас код продолжает звать их по именам своих аргументов;
--   * в значении правила лежат ОБА ключа: `duplicate_statuses` читает новый код,
--     `duplicate_status` — ещё не обновлённый (Zod лишние ключи отбрасывает).
-- После выкатки кода хвост убирается миграцией 20261030_request_duplicate_cleanup.sql.
-- ============================================================================

-- 1. Правило: список кодов. Старый ключ оставлен до выкатки кода (см. шапку).
UPDATE salary_config
   SET value = jsonb_build_object(
           'duplicate_statuses', jsonb_build_array('dubl-zayavki', 'dubliu-zaiavki'),
           'duplicate_status',   'dubliu-zaiavki'
       ),
       note = 'Правило исключения «Дубль заявки» из конверсии (числитель и знаменатель). Коды статуса списком: статус переименовывался при переезде на свою доску.'
 WHERE key = 'request_duplicate_rule';

-- 2. Знаменатель конверсии.
CREATE OR REPLACE FUNCTION public.salary_incoming_counts(p_start timestamp with time zone, p_end timestamp with time zone, p_exclusions text[], p_dup_status text DEFAULT NULL::text, p_ref_statuses text[] DEFAULT NULL::text[], p_req_statuses text[] DEFAULT NULL::text[], p_excluded_statuses text[] DEFAULT NULL::text[], p_dup_reasons text[] DEFAULT NULL::text[], p_not_our_statuses text[] DEFAULT NULL::text[], p_not_our_reasons text[] DEFAULT NULL::text[], p_reason_field text DEFAULT NULL::text, p_closing text DEFAULT NULL::text, p_est_statuses text[] DEFAULT NULL::text[], p_est_reasons text[] DEFAULT NULL::text[], p_est_patterns text[] DEFAULT NULL::text[], p_est_min_conf numeric DEFAULT NULL::numeric, p_use_history boolean DEFAULT false)
 RETURNS TABLE(manager_id bigint, incoming bigint)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT o.manager_id, count(*)
    FROM public.orders o
    WHERE o.created_at >= p_start AND o.created_at < p_end
      AND COALESCE(o.raw_payload->>'orderMethod', '') <> ALL(p_exclusions)
      -- Безусловное исключение спам-статусов (не заявки)
      AND (p_excluded_statuses IS NULL OR NOT (o.status = ANY(p_excluded_statuses)))
      -- Безусловное исключение «не нашей продукции»: по статусу ИЛИ причине отмены.
      -- COALESCE обязателен: причина отмены есть у меньшинства заказов, а NULL внутри
      -- NOT(...) сделал бы весь предикат NULL и выбросил бы строку из знаменателя.
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
      -- Исключение: «Смета» — запрос цены для бюджета на далёкое будущее.
      -- Только внутри статусов правила (по требованию — «Согласование отмены»,
      -- в «Отложено» не лезем). Ветка по причине отмены самодостаточна, ветка по
      -- тексту требует подтверждения вердиктом ИИ.
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
      -- Исключение: правомочный дубль на тендер
      AND NOT (
          p_dup_status IS NOT NULL
          AND p_ref_statuses IS NOT NULL
          -- дубль по статусу ИЛИ по причине отмены
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
              -- первоисточник цепочки дублей, а не первый попавшийся эталон
              WHERE r.number = public.salary_tender_duplicate_root(
                        (regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i'))[1],
                        p_dup_status, p_dup_reasons, p_reason_field, 5, p_use_history
                    )
                -- эталон ещё в тендере ЛИБО уже выиграл (ушёл в производство):
                -- закупку забрал он, дубли по нему больше не заявки
                AND (
                    r.status = ANY(p_ref_statuses)
                    OR (p_closing IS NOT NULL AND public.salary_order_won_production(r.order_id, r.status, p_closing))
                    -- эталон уже увели дальше (счёт выставлен / отменён — тендер
                    -- не выигран): тендером он от этого быть не перестал
                    OR (p_use_history AND public.salary_order_was_in_statuses(
                           r.order_id, r.status, p_ref_statuses))
                )
                -- Хотя бы одна общая позиция: артикул (нормализованный) + количество.
                -- Зеркалит orderItemKeys/itemsIntersect в lib/salary/tender-duplicates.ts.
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
      )
      -- Исключение: правомочный «Дубль заявки» (номер существующего эталона + причина)
      AND NOT (
          COALESCE(cardinality(p_req_statuses), 0) > 0
          AND o.status = ANY(p_req_statuses)
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
$function$;


-- 3. Числитель конверсии (и премия/выручка).
CREATE OR REPLACE FUNCTION public.salary_counted_orders(p_start timestamp with time zone, p_end timestamp with time zone, p_closing text, p_req_statuses text[] DEFAULT NULL::text[], p_excluded_statuses text[] DEFAULT NULL::text[], p_not_our_statuses text[] DEFAULT NULL::text[], p_not_our_reasons text[] DEFAULT NULL::text[], p_reason_field text DEFAULT NULL::text, p_dup_status text DEFAULT NULL::text, p_ref_statuses text[] DEFAULT NULL::text[], p_dup_reasons text[] DEFAULT NULL::text[], p_est_statuses text[] DEFAULT NULL::text[], p_est_reasons text[] DEFAULT NULL::text[], p_est_patterns text[] DEFAULT NULL::text[], p_est_min_conf numeric DEFAULT NULL::numeric, p_use_history boolean DEFAULT false)
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
    SELECT o.order_id, o.number,
           -- Менеджер — ТОТ, КТО ВЁЛ ЗАКАЗ НА МОМЕНТ ПРОДАЖИ, а не текущий.
           -- Продажа — свершившийся факт: передали клиента другому человеку,
           -- заработок остаётся за тем, кто продал. До 16.10.2026 бралось
           -- o.manager_id, и перевешивание заказа переписывало чужую премию:
           -- 15 продаж уволенной Никитиной на 3,5 млн ₽ числились за тремя
           -- действующими менеджерами.
           public.order_manager_at(o.order_id, c.entered_at) AS manager_id,
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
          COALESCE(cardinality(p_req_statuses), 0) > 0
          AND o.status = ANY(p_req_statuses)
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
$function$;
