-- Зарплата ОП: засчитывать «переданные в производство» СТРОГО ПО СТАТУСУ заказа.
-- ============================================================================
-- Контекст (инцидент 2026-07-22, заказ 53338):
--   Факт «передан в производство» = ТОЛЬКО статус заказа. Никакие другие поля
--   (в т.ч. кастом-поле «Дата передачи заказа в производство») фактом не являются.
--
-- Две дыры в прежней salary_counted_orders:
--   1) Источник `cf`: заказ засчитывался по кастом-полю-дате, даже если по СТАТУСУ
--      в производство он не уходил (пример: 53855/53577/53743/53960 — стоят в
--      «Согласование»/«Тендер», но с проставленной датой передачи).
--   2) Источник `hist` считал «когда-либо входил в send-assembling» без проверки,
--      что заказ там остался: 53338 вошёл в производство и через 1.5 часа был
--      откачен обратно в «Счет на оплате» — но продолжал считаться в ЗП.
--
-- Фикс:
--   • Убираем источник `cf` (кастом-поле больше не является сигналом счёта).
--     Членство и КАНОН-ДАТА периода берутся только из статуса: история перехода в
--     `p_closing` (authoritative) → фолбэк текущий статус = `p_closing` (statusUpdatedAt).
--   • Откат: если текущий статус заказа — предпроизводственный (по воронке RetailCRM
--     он ДО группы «Производство»), заказ сейчас не в производстве и в ЗП не идёт.
--     Список статусов — в salary_config['production_regression'].preproduction_statuses
--     (ноль хардкода; коды сверены со справочником RetailCRM).
--
-- Обратная совместимость: сигнатура функции не меняется — metrics.ts вызывает так же.
-- Применяется к открытым периодам через пересчёт (закрытые не мутируются).
-- ============================================================================

-- 1. Список предпроизводственных статусов основной воронки продаж (Новый /
--    Согласование / На оплате) — заказ в таком статусе ещё/уже НЕ в производстве.
--    effective_from ранний, чтобы правило действовало на все открытые периоды.
--    Необязательный ключ конфига (не входит в SALARY_CONFIG_SCHEMAS) — читается
--    напрямую из RPC, отсутствие ключа = правило не срабатывает (fail-open).
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'production_regression',
    '{"preproduction_statuses":["zapros-kontaktov","novyi-1","otlozeno","ozidanie-tz","v-proscete","na-soglasovanii","raschet","availability","prepayed"]}'::jsonb,
    '2020-01-01',
    'Статусы воронки RetailCRM ДО группы «Производство» (Новый/Согласование/На оплате). Откат сюда из send-assembling = заказ не в производстве, из ЗП исключается.',
    'migration:20260722'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- 2. Переопределение RPC: статус-онли.
CREATE OR REPLACE FUNCTION public.salary_counted_orders(
    p_start timestamp with time zone,
    p_end timestamp with time zone,
    p_closing text,
    p_req_status text DEFAULT NULL::text,
    p_excluded_statuses text[] DEFAULT NULL::text[]
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
      );
$function$;
