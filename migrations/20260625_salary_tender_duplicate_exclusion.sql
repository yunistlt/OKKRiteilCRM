-- ============================================================================
-- Дубли на тендер не учитываются в знаменателе конверсии — при ПРАВОМОЧНОЙ
-- простановке статуса менеджером. Правомочность (все три условия):
--   1) в комментарии оператора указан номер заказа-эталона («дубль 53579»);
--   2) стоимость товаров БЕЗ скидок у дубля = у эталона (Σ initialPrice×кол-во;
--      позиционные скидки могут отличаться — сравниваем именно базовую стоимость);
--   3) эталон в одном из статусов «тендерной» группы (Тендер / Ожидание выхода
--      тендера) — список настраивается в конфиге.
-- Фиктивные дубли (нет номера / суммы разные / эталон не в «Тендере») остаются
-- в знаменателе — встроенный контроль против злоупотребления статусом.
--
-- Аддитивно: новый ключ конфига + замена RPC salary_incoming_counts. Коды
-- статусов берём из конфига (zero-hardcode), не зашиваем в SQL/код.
-- ============================================================================

-- 1) Правило исключения дублей (effective с старта модуля ЗП).
INSERT INTO public.salary_config (key, value, effective_from, note, created_by)
VALUES (
    'tender_duplicate_rule',
    '{"duplicate_status":"dubl-na-tender","reference_statuses":["tender","ozhidanie-vykhoda-tendera"]}'::jsonb,
    '2026-07-01',
    'Дубль на тендер не учитывается в знаменателе конверсии при правомочной простановке: номер эталона в комментарии оператора, равные суммы, эталон в одном из статусов «тендерной» группы.',
    'system'
)
ON CONFLICT (key, effective_from) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note;

-- 2) Знаменатель конверсии: входящие заявки периода минус ПРАВОМОЧНЫЕ дубли.
--    Новые параметры p_dup_status / p_ref_statuses — НЕОБЯЗАТЕЛЬНЫЕ (DEFAULT NULL),
--    чтобы старый деплой (вызов из 3 аргументов) продолжал работать БЕЗ исключения
--    дублей до выкатки нового кода. Когда оба переданы — исключение применяется.
--    Дропаем прежние сигнатуры, чтобы не плодить неоднозначные перегрузки.
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[]);
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text);
DROP FUNCTION IF EXISTS public.salary_incoming_counts(timestamptz, timestamptz, text[], text, text[]);

CREATE OR REPLACE FUNCTION public.salary_incoming_counts(
    p_start timestamptz,
    p_end timestamptz,
    p_exclusions text[],
    p_dup_status text DEFAULT NULL,
    p_ref_statuses text[] DEFAULT NULL
)
RETURNS TABLE(manager_id bigint, incoming bigint)
LANGUAGE sql STABLE AS $$
    SELECT o.manager_id, count(*)
    FROM public.orders o
    WHERE o.created_at >= p_start AND o.created_at < p_end
      AND COALESCE(o.raw_payload->>'orderMethod', '') <> ALL(p_exclusions)
      -- Исключаем заказ из знаменателя ТОЛЬКО если это правомочный дубль на тендер.
      -- При вызове без правила (p_dup_status IS NULL) исключение не применяется.
      AND NOT (
          p_dup_status IS NOT NULL
          AND p_ref_statuses IS NOT NULL
          AND o.status = p_dup_status
          AND EXISTS (
              SELECT 1
              FROM public.orders r
              WHERE r.number = (
                        regexp_match(
                            o.raw_payload->>'managerComment',
                            '(?:дубль|дубл|dubl)\D*(\d{3,6})',
                            'i'
                        )
                    )[1]
                AND r.status = ANY(p_ref_statuses)
                -- Стоимость товаров БЕЗ скидок (Σ initialPrice×кол-во) должна совпадать.
                -- Зеркалит goodsCostBeforeDiscount() в lib/salary/tender-duplicates.ts.
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
    GROUP BY o.manager_id;
$$;
