-- ============================================================================
-- Дубль на тендер: сходство по СОСТАВУ ТОВАРА вместо равенства сумм.
-- Плюс «не наша продукция» выводится из конверсии.
--
-- Контекст (разбор ОКК за июль 2026, менеджер Матвеева):
--   Прежнее условие «Σ(цена без скидки × кол-во) дубля = сумме эталона» не
--   выживает в реальном тендере — из 47 июльских «Дублей на тендер» проходило
--   только 18. Настоящие дубли расходятся по сумме, потому что:
--     • тендер разбит по лотам (у эталона 2 позиции, у дубля 1) — 53746/53751/53848;
--     • доставка идёт отдельной строкой (53827: 867184 − 168300 = 698884)
--       или вшита в цену позиции (53753);
--     • копеечное округление (53977: 116842 против 116843 за штуку);
--     • торг. организация просит «без НДС», конечнику цена другая.
--   Заменяем на «хотя бы одна позиция совпадает по АРТИКУЛУ и КОЛИЧЕСТВУ» —
--   подделать труднее, чем сумму (надо скопировать позицию из эталона), а
--   покрытие вырастает до 35/47.
--
--   Три дополнительные дыры, закрываемые здесь же:
--     1) Цепочка «дубль дубля» (53886 → 53873 → 53478): эталон сам в статусе
--        дубля, условие «эталон в тендере» ломается на середине. Разворачиваем
--        до первоисточника (salary_tender_duplicate_root).
--     2) Отменённый дубль (53757/53761/53929) уходит в «Согласование отмены»,
--        правило по статусу до него не добирается. Признаём дублем и по причине
--        отмены «Отмена: Дубль на тендер» — поле заполнено корректно.
--     3) «Не наша продукция» (53700/53714/53842 — ножничный подъёмник, печь SNOL,
--        щитовые шкафы) вообще не выводилась из конверсии. Ловим по статусу
--        «Нет таких позиций» ИЛИ по одноимённой причине отмены: за май–июль в
--        финальный статус перешёл 1 заказ, все отмены копятся в «Согласовании
--        отмены», а причину отмены проставляют (40 заказов за июль).
--
-- ПОРЯДОК ВЫКАТКИ: миграция первой, код — вторым. Новые параметры RPC
-- необязательные (DEFAULT NULL) и до передачи из кода ничего не меняют, а
-- getResolvedConfig требует новые ключи конфига уже на первом запросе.
--
-- Ноль хардкода: коды статусов и причин — в salary_config; SQL обязан зеркалить
-- lib/salary/tender-duplicates.ts (orderItemKeys / itemsIntersect /
-- resolveDuplicateRoot / isNotOurProduct).
-- ============================================================================

-- 1) Правило дублей: + причины отмены, равносильные статусу «Дубль на тендер».
--    effective_from = 2026-05-01 — старт модуля ЗП (как у остальных ключей),
--    иначе конфиг не резолвится для мая/июня и расчёт падает.
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'tender_duplicate_rule',
    '{"duplicate_status":"dubl-na-tender","reference_statuses":["tender","ozhidanie-vykhoda-tendera"],"duplicate_cancel_reasons":["tender-dubl"]}'::jsonb,
    '2026-05-01',
    'Дубль на тендер не учитывается в знаменателе конверсии при правомочной простановке: номер эталона в комментарии оператора, совпадение хотя бы одной позиции по артикулу и количеству, первоисточник цепочки в одном из статусов «тендерной» группы. Дублем считается также отменённый заказ с причиной отмены «Отмена: Дубль на тендер».',
    'migration:20260729'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- 2) «Не наша продукция» — из конверсии целиком (числитель и знаменатель).
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'not_our_product_rule',
    '{"statuses":["net-takikh-pozitsii"],"cancel_reasons":["u-nas-net-takih-pozitsij"]}'::jsonb,
    '2026-05-01',
    'Заявка не на нашу продукцию — не потерянная продажа, из конверсии исключается целиком. Ловится по статусу «Нет таких позиций» либо по одноимённой причине отмены (финальные статусы отмены на практике почти не проставляют).',
    'migration:20260729'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- 3) Код кастом-поля с причиной отмены (справочник RetailCRM prichiny_otmeny_zakazov).
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'cancel_reason_field',
    '{"code":"prichiny_otmeny"}'::jsonb,
    '2026-05-01',
    'Код кастом-поля заказа «Причины Отмены». Отсюда его берут правила дублей и «не нашей продукции».',
    'migration:20260729'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- ============================================================================
-- 4) Первоисточник цепочки дублей.
--    Идём по номерам эталонов, пока текущий заказ сам помечен как дубль
--    (статусом или причиной отмены). Предел глубины и множество посещённых —
--    защита от циклов. Зеркалит resolveDuplicateRoot() в TS.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_tender_duplicate_root(text, text, text[], text, integer);
CREATE OR REPLACE FUNCTION public.salary_tender_duplicate_root(
    p_number text,
    p_dup_status text,
    p_dup_reasons text[],
    p_reason_field text,
    p_max_depth integer DEFAULT 5
)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_current text := p_number;
    v_seen text[] := ARRAY[p_number];
    v_status text;
    v_reason text;
    v_comment text;
    v_next text;
    i integer;
BEGIN
    FOR i IN 1..p_max_depth LOOP
        SELECT o.status,
               o.raw_payload->'customFields'->>p_reason_field,
               o.raw_payload->>'managerComment'
          INTO v_status, v_reason, v_comment
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
           AND NOT (COALESCE(v_reason, '') = ANY(COALESCE(p_dup_reasons, ARRAY[]::text[]))) THEN
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
-- 4a) «Заказ выиграл» — уходил ли когда-либо в производство (closing-статус).
--     Текущего статуса мало: выигранный заказ едет дальше по воронке (отгружен,
--     выполнен). Канва та же, что у членства в числителе salary_counted_orders:
--     история перехода в closing-статус ЛИБО текущий статус = closing.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_order_won_production(bigint, text, text);
CREATE OR REPLACE FUNCTION public.salary_order_won_production(
    p_order_id bigint,
    p_status text,
    p_closing text
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT p_status = p_closing
        OR EXISTS (
            SELECT 1 FROM public.order_history_log h
             WHERE h.retailcrm_order_id = p_order_id
               AND h.field = 'status'
               AND h.new_value LIKE '%"code":"' || p_closing || '"%'
        );
$$;

-- ============================================================================
-- 5) Знаменатель конверсии.
--    Новые необязательные параметры: причины отмены дубля, правило «не нашей
--    продукции», код поля причины отмены. Пока код их не передаёт — поведение
--    прежнее (кроме критерия сходства, см. ниже).
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[]);
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[], text[], text[], text[], text);
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
    p_closing text DEFAULT NULL
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
      -- Исключение: правомочный дубль на тендер
      AND NOT (
          p_dup_status IS NOT NULL
          AND p_ref_statuses IS NOT NULL
          -- дубль по статусу ИЛИ по причине отмены
          AND (
              o.status = p_dup_status
              OR COALESCE(o.raw_payload->'customFields'->>p_reason_field, '')
                 = ANY(COALESCE(p_dup_reasons, ARRAY[]::text[]))
          )
          AND EXISTS (
              SELECT 1
              FROM public.orders r
              -- первоисточник цепочки дублей, а не первый попавшийся эталон
              WHERE r.number = public.salary_tender_duplicate_root(
                        (regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i'))[1],
                        p_dup_status, p_dup_reasons, p_reason_field, 5
                    )
                -- эталон ещё в тендере ЛИБО уже выиграл (ушёл в производство):
                -- закупку забрал он, дубли по нему больше не заявки
                AND (
                    r.status = ANY(p_ref_statuses)
                    OR (p_closing IS NOT NULL AND public.salary_order_won_production(r.order_id, r.status, p_closing))
                )
                -- Хотя бы одна общая позиция: артикул (нормализованный) + количество.
                -- Зеркалит orderItemKeys/itemsIntersect в lib/salary/tender-duplicates.ts.
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(o.raw_payload->'items', '[]'::jsonb)) oi
                    JOIN jsonb_array_elements(COALESCE(r.raw_payload->'items', '[]'::jsonb)) ri
                      ON COALESCE((ri->>'quantity')::numeric, 0) = COALESCE((oi->>'quantity')::numeric, 0)
                     -- тот же товар по ЛЮБОМУ идентификатору: номенклатура учётной
                     -- системы / артикул / внешний код. В каталоге CRM встречаются
                     -- две карточки одной номенклатуры с разными артикулами.
                     -- Разные «пустышки» слева и справа — чтобы пустое не равнялось пустому.
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
-- 6) Числитель конверсии (и премия/выручка): + исключение «не нашей продукции».
--    База — 20260722_salary_counted_orders_status_only.sql, все её условия
--    сохраняем (статус-онли членство, откат из производства, дубль заявки).
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text, text, text[]);
DROP FUNCTION IF EXISTS public.salary_counted_orders(timestamptz, timestamptz, text, text, text[], text[], text[], text);
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
    p_dup_reasons text[] DEFAULT NULL::text[]
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
          )
          AND EXISTS (
              SELECT 1
              FROM public.orders r
              WHERE r.number = public.salary_tender_duplicate_root(
                        (regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\D*(\d{3,6})', 'i'))[1],
                        p_dup_status, p_dup_reasons, p_reason_field, 5
                    )
                AND (
                    r.status = ANY(p_ref_statuses)
                    OR public.salary_order_won_production(r.order_id, r.status, p_closing)
                )
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(o.raw_payload->'items', '[]'::jsonb)) oi
                    JOIN jsonb_array_elements(COALESCE(r.raw_payload->'items', '[]'::jsonb)) ri
                      ON COALESCE((ri->>'quantity')::numeric, 0) = COALESCE((oi->>'quantity')::numeric, 0)
                     -- тот же товар по ЛЮБОМУ идентификатору: номенклатура учётной
                     -- системы / артикул / внешний код. В каталоге CRM встречаются
                     -- две карточки одной номенклатуры с разными артикулами.
                     -- Разные «пустышки» слева и справа — чтобы пустое не равнялось пустому.
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
