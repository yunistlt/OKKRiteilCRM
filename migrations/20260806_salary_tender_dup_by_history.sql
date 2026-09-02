-- ============================================================================
-- Дубль на тендер: признак «тендер/дубль» берём из ИСТОРИИ статусов, а не
-- только из текущего.
--
-- Проблема (ОКК, август 2026). Правило опирается на ТЕКУЩИЙ статус заказов, а
-- статус по природе меняется по ходу жизни заказа. Отсюда два реальных сбоя:
--   1) Эталон уводят в отмену (тендер не выигран) — он выпадает из «тендерной»
--      группы, и все дубли по нему задним числом возвращаются в знаменатель
--      конверсии, будто это были полноценные заявки.
--   2) Эталон уводят вперёд («Счёт выставлен») — тендер ВЫИГРАН, то есть лучший
--      исход, а дубли снова учитываются: salary_order_won_production ловит
--      только производство, до счёта очередь не дошла.
--   3) Зеркально: сам дубль переводят в «Согласование отмены», причину отмены
--      ещё не проставили — и дубль считается полноценной заявкой.
-- Итог: одна и та же ведомость пересчитывается по-разному в зависимости от
-- того, куда за это время уехали заказы. Это хуже, чем неверная цифра.
--
-- Решение. Признак должен быть неизменяемым фактом. История статусов у нас есть
-- за полтора года и наполняется штатно (order_history_log, воркер
-- retailcrm-history-delta), поэтому:
--   • эталон правомочен, если он СЕЙЧАС или КОГДА-ЛИБО был в «тендерном»
--     статусе (плюс прежняя ветка «выиграл — ушёл в производство»);
--   • заказ считается дублем, если он СЕЙЧАС или КОГДА-ЛИБО был в статусе
--     «Дубль на тендер» (плюс прежняя ветка по причине отмены).
-- Контроль злоупотребления не ослабевает: номер эталона в комментарии и
-- совпадение позиции по артикулу+количеству проверяются как прежде.
--
-- Применение — с ТЕКУЩЕГО месяца: правило включает новая версия конфига с
-- effective_from = 2026-08-01 (флаг use_status_history), закрытые периоды
-- считаются по-старому и не переписываются задним числом.
--
-- ПОРЯДОК ВЫКАТКИ: миграция первой, код — вторым. Новый параметр RPC
-- p_use_history необязательный (DEFAULT false) и до передачи из кода ничего не
-- меняет.
--
-- Ноль хардкода: коды статусов — в salary_config. SQL обязан зеркалить
-- lib/salary/tender-duplicates.ts (isTenderDuplicate / evaluateDuplicate) и
-- lib/salary/report-details.ts (загрузка флагов истории).
-- База — 20260803_salary_estimate_exclusion.sql, все её условия сохранены.
-- ============================================================================

-- ============================================================================
-- 1) Версия правила с включённой историей — с августа 2026.
--    Прежняя версия (effective_from = 2026-05-01) остаётся нетронутой, поэтому
--    май–июль считаются ровно так же, как были закрыты.
-- ============================================================================
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'tender_duplicate_rule',
    '{"duplicate_status":"dubl-na-tender","reference_statuses":["tender","ozhidanie-vykhoda-tendera"],"duplicate_cancel_reasons":["tender-dubl"],"use_status_history":true}'::jsonb,
    '2026-08-01',
    'То же правило дублей на тендер, но признак «эталон — тендер» и «заказ — дубль» берётся из истории статусов (order_history_log), а не только из текущего статуса. Иначе перевод эталона в отмену («не выиграли») или вперёд («Счёт выставлен»), равно как и перевод самого дубля в «Согласование отмены», возвращал дубли в знаменатель конверсии задним числом.',
    'migration:20260806'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- ============================================================================
-- 2) Был ли заказ когда-либо в одном из статусов.
--    Канва та же, что у salary_order_won_production: текущий статус ЛИБО запись
--    в истории о переходе в этот статус. new_value хранится как JSON-строка
--    вида {"code":"tender", ...} — сравниваем по подстроке с полным ключом,
--    как и в остальных RPC ведомости.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_order_was_in_statuses(bigint, text, text[]);
CREATE OR REPLACE FUNCTION public.salary_order_was_in_statuses(
    p_order_id bigint,
    p_status text,
    p_statuses text[]
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(p_status = ANY(p_statuses), false)
        OR EXISTS (
            SELECT 1
            FROM public.order_history_log h
            JOIN unnest(COALESCE(p_statuses, ARRAY[]::text[])) s ON true
            WHERE h.retailcrm_order_id = p_order_id
              AND h.field = 'status'
              AND h.new_value LIKE '%"code":"' || s || '"%'
        );
$$;

-- ============================================================================
-- 3) Корень цепочки дублей — тоже с учётом истории.
--    Без этого цепочка «дубль дубля» рвётся на звене, которое увели из статуса
--    дубля: обход посчитает его первоисточником и правило не сработает.
--    Полная копия 20260729_salary_duplicate_by_items.sql + p_use_history.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_tender_duplicate_root(text, text, text[], text, integer);
DROP FUNCTION IF EXISTS public.salary_tender_duplicate_root(text, text, text[], text, integer, boolean);
CREATE OR REPLACE FUNCTION public.salary_tender_duplicate_root(
    p_number text,
    p_dup_status text,
    p_dup_reasons text[],
    p_reason_field text,
    p_max_depth integer DEFAULT 5,
    p_use_history boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_current text := p_number;
    v_seen text[] := ARRAY[p_number];
    v_order_id bigint;
    v_status text;
    v_reason text;
    v_comment text;
    v_next text;
    i integer;
BEGIN
    FOR i IN 1..p_max_depth LOOP
        SELECT o.order_id,
               o.status,
               o.raw_payload->'customFields'->>p_reason_field,
               o.raw_payload->>'managerComment'
          INTO v_order_id, v_status, v_reason, v_comment
          FROM public.orders o
         WHERE o.number = v_current
         LIMIT 1;

        -- Заказа нет в базе — дальше идти некуда.
        IF v_status IS NULL THEN
            RETURN v_current;
        END IF;

        -- Текущий заказ не дубль — это и есть первоисточник.
        -- COALESCE обязателен: без него у заказа без причины отмены сравнение даёт
        -- NULL, условие выхода становится NULL и обход уходит дальше по цепочке.
        IF v_status IS DISTINCT FROM p_dup_status
           AND NOT (COALESCE(v_reason, '') = ANY(COALESCE(p_dup_reasons, ARRAY[]::text[])))
           AND NOT (p_use_history AND public.salary_order_was_in_statuses(
                        v_order_id, v_status, ARRAY[p_dup_status])) THEN
            RETURN v_current;
        END IF;

        v_next := (regexp_match(COALESCE(v_comment, ''), '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i'))[1];
        IF v_next IS NULL OR v_next = ANY(v_seen) THEN
            RETURN v_current;
        END IF;

        v_seen := v_seen || v_next;
        v_current := v_next;
    END LOOP;

    RETURN v_current;
END;
$$;

-- ============================================================================
-- 4) Знаменатель и числитель конверсии: + ветки по истории статусов.
--    Полная копия 20260803_salary_estimate_exclusion.sql, изменения помечены
--    комментариями внутри предикатов.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[], text[], text[], text[], text, text);
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[], text[], text[], text[], text, text, text[], text[], text[], numeric);
CREATE OR REPLACE FUNCTION public.salary_incoming_counts(
    p_start timestamptz,
    p_end timestamptz,
    p_exclusions text[],
    p_dup_status text DEFAULT NULL,
    p_ref_statuses text[] DEFAULT NULL,
    p_req_status text DEFAULT NULL,
    p_excluded_statuses text[] DEFAULT NULL,
    p_dup_reasons text[] DEFAULT NULL,
    p_not_our_statuses text[] DEFAULT NULL,
    p_not_our_reasons text[] DEFAULT NULL,
    p_reason_field text DEFAULT NULL,
    p_closing text DEFAULT NULL,
    p_est_statuses text[] DEFAULT NULL,
    p_est_reasons text[] DEFAULT NULL,
    p_est_patterns text[] DEFAULT NULL,
    p_est_min_conf numeric DEFAULT NULL,
    -- Признак «дубль/эталон» брать не только из ТЕКУЩЕГО статуса, но и из истории
    -- (order_history_log). Включается версией конфига — старые периоды считаются
    -- по-прежнему. См. шапку миграции.
    p_use_history boolean DEFAULT false
)
RETURNS TABLE(manager_id bigint, incoming bigint)
LANGUAGE sql STABLE AS $$
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
          o.status = ANY(COALESCE(p_not_our_statuses, ARRAY[]::text[]))
          OR COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
             = ANY(COALESCE(p_not_our_reasons, ARRAY[]::text[]))
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

-- ============================================================================
-- 4) Числитель конверсии (и премия/выручка): + исключение «Сметы».
--    Симметрия со знаменателем. На практике почти холостой ход: за 6 месяцев
--    ни один заказ с причиной «Смета» не дошёл до закрывающего статуса — но
--    расхождение правил между числителем и знаменателем опаснее лишнего условия.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text, text, text[], text[], text[], text, text, text[], text[]);
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text, text, text[], text[], text[], text, text, text[], text[], text[], text[], text[], numeric);
CREATE OR REPLACE FUNCTION public.salary_counted_orders(
    p_start timestamp with time zone,
    p_end timestamp with time zone,
    p_closing text,
    p_req_status text DEFAULT NULL::text,
    p_excluded_statuses text[] DEFAULT NULL::text[],
    p_not_our_statuses text[] DEFAULT NULL::text[],
    p_not_our_reasons text[] DEFAULT NULL::text[],
    p_reason_field text DEFAULT NULL::text,
    p_dup_status text DEFAULT NULL::text,
    p_ref_statuses text[] DEFAULT NULL::text[],
    p_dup_reasons text[] DEFAULT NULL::text[],
    p_est_statuses text[] DEFAULT NULL::text[],
    p_est_reasons text[] DEFAULT NULL::text[],
    p_est_patterns text[] DEFAULT NULL::text[],
    p_est_min_conf numeric DEFAULT NULL,
    p_use_history boolean DEFAULT false
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
$function$;

