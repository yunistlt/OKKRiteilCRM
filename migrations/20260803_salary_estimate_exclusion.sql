-- ============================================================================
-- «Смета» выводится из конверсии (числитель и знаменатель).
--
-- Контекст: часть заказов — не спрос, а запрос стоимости «для бюджета» на
-- далёкое будущее: клиент закладывает смету на закупку через год-два или без
-- срока вообще. Продажи тут нет и быть не могло, но в знаменателе конверсии
-- такой заказ стоит наравне с реальной заявкой и занижает показатель менеджера.
--
-- Разбор данных за 6 месяцев (scratch/probe-smeta*.mjs):
--   • В статусе «Согласование отмены» 77 кандидатов: 58 с причиной отмены
--     «Смета» (calc_rate), 38 с текстовым маркером в комментариях,
--     пересечение всего 19 — сигналы почти не дублируют друг друга.
--   • Перекос по менеджерам заметный: 20 / 18 / 15 заказов у троих, у остальных
--     единицы. То есть правило меняет расклад, а не косметику.
--   • Транскрипты звонков есть только у 36 из 77 (47%) — требовать
--     ИИ-подтверждение для ВСЕХ нельзя, половину смет мы бы не исключили.
--
-- Отсюда двухветочное правило (оба условия внутри статуса «Согласование отмены»,
-- в «Отложено» и прочие статусы правило намеренно не лезет):
--   1) причина отмены = «Смета» — явный выбор менеджера из справочника CRM,
--      исключаем безусловно, как «не нашу продукцию»;
--   2) только текстовый маркер в комментариях («смета», «бюджетирование») —
--      сам по себе слишком шумный («не работают по сметам», «запрос сметы был»),
--      поэтому требует подтверждения по диалогу: вердикт ИИ-классификатора в
--      order_estimate_verdicts (закупка не раньше чем через год либо срок
--      неизвестен) с уверенностью не ниже порога.
-- Нет вердикта (звонков не было, расшифровки нет) — заказ ОСТАЁТСЯ в конверсии.
-- Это встроенный контроль злоупотребления, та же логика, что у дублей.
--
-- ПОРЯДОК ВЫКАТКИ: миграция первой, код — вторым. Новые параметры RPC
-- необязательные (DEFAULT NULL) и до передачи из кода ничего не меняют, а
-- getResolvedConfig требует новый ключ конфига уже на первом запросе.
--
-- Ноль хардкода: статусы, причины и маркеры — в salary_config; SQL обязан
-- зеркалить lib/salary/estimates.ts (isEstimateReason / hasEstimateMarker /
-- evaluateEstimate). База — 20260729_salary_duplicate_by_items.sql, все её
-- условия сохраняем без изменений.
-- ============================================================================

-- 1) Правило «Смета».
--    effective_from = 2026-05-01 — старт модуля ЗП (как у остальных ключей),
--    иначе конфиг не резолвится для мая/июня и расчёт падает.
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'estimate_rule',
    '{"statuses":["soglasovanie-otmeny"],"cancel_reasons":["calc_rate"],"comment_patterns":["смет","бюджетир"],"min_confidence":0.7}'::jsonb,
    '2026-05-01',
    'Запрос стоимости «для сметы/бюджета» на далёкое будущее — не потерянная продажа, из конверсии исключается целиком. Ловится в статусе «Согласование отмены» по причине отмены «Смета» либо по текстовому маркеру в комментариях с подтверждением по диалогу (вердикт ИИ в order_estimate_verdicts).',
    'migration:20260803'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- ============================================================================
-- 2) Вердикты ИИ-классификатора «смета ли это» по диалогу с клиентом.
--    Пишет воркер order-estimate-classify, читают RPC конверсии и детализация
--    ведомости. Расчёт ЗП модель НЕ вызывает — только читает готовый вердикт.
--    is_estimate = NULL — «нет данных для решения» (звонков/расшифровок нет);
--    такой заказ остаётся в конверсии.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_estimate_verdicts (
    retailcrm_order_id bigint PRIMARY KEY,
    is_estimate boolean,
    confidence numeric,
    -- Горизонт закупки со слов клиента: 'god_plus' (не раньше чем через год),
    -- 'neizvestno' (срок не назван), 'blizhaishii' (закупка в обозримом сроке).
    horizon text,
    reasoning text,          -- по-русски, показывается в раскрытии конверсии
    evidence jsonb,          -- id звонков и цитаты, на которых основан вердикт
    model text,
    evaluated_at timestamptz NOT NULL DEFAULT now()
);

-- Предикаты RPC ищут по «есть подтверждённый вердикт», а не по всей таблице.
CREATE INDEX IF NOT EXISTS idx_order_estimate_verdicts_confirmed
    ON public.order_estimate_verdicts (retailcrm_order_id)
    WHERE is_estimate IS TRUE;

-- ============================================================================
-- 3) Знаменатель конверсии: + исключение «Сметы».
--    Полная копия 20260729_salary_duplicate_by_items.sql с одним новым блоком.
-- ============================================================================
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[], text, text[], text[], text[], text[], text, text);
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
    p_est_min_conf numeric DEFAULT NULL
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
    p_est_min_conf numeric DEFAULT NULL
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

-- ============================================================================
-- 5) Промпт классификатора — в ai_prompts, не прозой в коде (знания ИИ в РАГ).
--    Редактируется в /settings/prompts; в коде остаётся только фолбэк на случай
--    пустой таблицы.
-- ============================================================================
INSERT INTO public.ai_prompts (key, description, system_prompt, model, temperature, is_active)
VALUES (
    'salary_estimate_classifier',
    'Смета или реальная закупка: классификация заказа по расшифровкам звонков. Вердикт исключает заказ из конверсии в расчёте ЗП.',
    'Ты аналитик отдела продаж завода металлоконструкций. По расшифровкам звонков определи, был ли запрос клиента сметой — то есть запросом цены для закладки в бюджет, а не подготовкой реальной закупки.

Признаки сметы:
• клиент прямо говорит, что закупка планируется не раньше чем через год (следующий год и далее);
• клиент говорит, что срок закупки неизвестен, «пока собираем предложения», «для бюджетирования», «заложить в смету»;
• цена нужна для тендерной/проектной документации без текущей закупки.

НЕ смета:
• закупка обсуждается в обозримый срок (недели, ближайшие месяцы);
• клиент торгуется, сравнивает цены, уточняет сроки поставки для текущей потребности;
• слово «смета» произнесено, но речь о документообороте по текущей сделке.

Отвечай строго JSON:
{"is_estimate": true|false|null, "horizon": "god_plus"|"neizvestno"|"blizhaishii"|null, "confidence": 0..1, "reasoning": "кратко по-русски", "quotes": ["дословная цитата из диалога"]}

is_estimate = null, если о сроке закупки в диалоге ничего не сказано — это «нет данных», а не «не смета».
confidence — насколько уверенно реплики клиента подтверждают вывод.
Опирайся ТОЛЬКО на реплики в расшифровке, ничего не додумывай. Цитаты приводи дословно.',
    'gpt-4o-mini',
    0.1,
    true
)
ON CONFLICT (key) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    updated_at = now();
