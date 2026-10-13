-- ============================================================================
-- Матчинг переделан на ОКК: привязка не угадывается, а устанавливается.
--
-- Решение владельца 05.10.2026: «у нас уже есть матчинг с ритейлом, его надо
-- переделать на ОКК». Отдельного хранилища привязок заводить не нужно — всё
-- живёт в `call_order_matches`, где уже есть `match_type`, `confidence_score`,
-- `explanation` и `matching_factors`. Таблица `call_order_bindings`, заведённая
-- этим же днём по недосмотру, сносится, её содержимое переезжает сюда.
--
-- Типы привязки (match_type), от надёжного к слабому:
--   okk_card     — набран из карточки заказа, заказ известен в момент набора;
--   manual       — менеджер указал заказ руками;
--   okk_auto     — клиент однозначно определён по номеру и у него РОВНО ОДИН
--                  открытый заказ; других толкований нет;
--   ai_suggested — предложено по расшифровке разговора. Это ПОДСКАЗКА, в связь
--                  звонка с заказом она не попадает, пока человек не подтвердит
--                  (тогда запись становится `manual`);
--   retailcrm    — привязку сделала RetailCRM (уходит вместе с ней);
--   by_phone_*   — старый матчинг по телефону, ошибается примерно в трети
--                  случаев. Новых таких записей не делаем, старые оставлены как
--                  история: за 90 дней 1 285 из 1 776 его привязок — вообще не
--                  разговоры, а попытки дозвона.
--
-- Идентификатор звонка хранится как пришёл, а сверяется без учёта регистра:
-- Телфин отдаёт его прописными, набор из карточки возвращал строчными.
-- ============================================================================

-- Новые типы привязки: прежний список знал только матчинг по телефону,
-- RetailCRM и ручную правку.
ALTER TABLE public.call_order_matches DROP CONSTRAINT IF EXISTS call_order_matches_match_type_check;
ALTER TABLE public.call_order_matches ADD CONSTRAINT call_order_matches_match_type_check
    CHECK (match_type = ANY (ARRAY[
        'okk_card', 'manual', 'okk_auto', 'ai_suggested', 'retailcrm',
        'by_phone_time', 'by_phone_manager', 'by_partial_phone',
        'by_phone_day', 'by_phone_any', 'by_phone_window'
    ]));

-- Переносим карточные привязки из временной таблицы, если она была заведена.
INSERT INTO public.call_order_matches
    (telphin_call_id, retailcrm_order_id, match_type, confidence_score, matched_at, rule_id, explanation)
SELECT b.call_key, b.order_id, 'okk_card', 1.00, b.bound_at, 'okk_v1', 'Набран из карточки заказа в ОКК'
  FROM public.call_order_bindings b
 WHERE b.status = 'confirmed'
ON CONFLICT (telphin_call_id, retailcrm_order_id) DO UPDATE
    SET match_type = 'okk_card', confidence_score = 1.00, rule_id = 'okk_v1',
        explanation = 'Набран из карточки заказа в ОКК';

-- Представление пересоздаётся ниже, поэтому сначала снимаем его со старой таблицы.
DROP VIEW IF EXISTS public.call_order_link;
DROP TABLE IF EXISTS public.call_order_bindings;

-- Карточные привязки, которых ещё нет в матчинге (звонки до этой миграции).
INSERT INTO public.call_order_matches
    (telphin_call_id, retailcrm_order_id, match_type, confidence_score, matched_at, rule_id, explanation)
SELECT DISTINCT ON (upper(t.telphin_call_id))
       upper(t.telphin_call_id), o.id, 'okk_card', 1.00, t.ingested_at, 'okk_v1',
       'Набран из карточки заказа в ОКК'
  FROM public.raw_telphin_calls t
  JOIN public.orders o ON o.id::text = (t.raw_payload ->> 'order_id')
 WHERE t.raw_payload ->> 'order_id' IS NOT NULL
 ORDER BY upper(t.telphin_call_id), t.ingested_at DESC
ON CONFLICT (telphin_call_id, retailcrm_order_id) DO UPDATE
    SET match_type = 'okk_card', confidence_score = 1.00, rule_id = 'okk_v1',
        explanation = 'Набран из карточки заказа в ОКК';

CREATE INDEX IF NOT EXISTS idx_call_order_matches_type ON public.call_order_matches (match_type);
CREATE INDEX IF NOT EXISTS idx_call_order_matches_call_upper ON public.call_order_matches ((upper(telphin_call_id)));
CREATE INDEX IF NOT EXISTS idx_raw_telphin_call_id_upper ON public.raw_telphin_calls ((upper(telphin_call_id)));

-- ============================================================================
-- Связь звонка с заказом: один источник, порядок доверия — по типу привязки.
-- ============================================================================
DROP VIEW IF EXISTS public.call_order_link;
CREATE VIEW public.call_order_link AS
WITH razgovor AS (
    -- Разговор с клиентом: хоть одно плечо говорило либо осталась запись.
    -- Закон владельца: автодозвоны и автоответчики звонком не считаются.
    SELECT t.telphin_call_id,
           (
               EXISTS (
                   SELECT 1
                     FROM jsonb_array_elements(COALESCE(t.raw_payload -> 'cdr', '[]'::jsonb)) c
                    WHERE COALESCE((c ->> 'duration')::int, 0) > 0
               )
               OR t.recording_url IS NOT NULL
           ) AS answered
      FROM public.raw_telphin_calls t
),
zvonok AS (
    -- Из двух строк одного разговора берём ту, где есть сам разговор.
    SELECT DISTINCT ON (upper(t.telphin_call_id))
           t.telphin_call_id,
           upper(t.telphin_call_id) AS call_key,
           t.started_at,
           t.duration_sec,
           t.direction,
           nullif(t.raw_payload ->> 'manager_id', '')::bigint AS manager_id
      FROM public.raw_telphin_calls t
     ORDER BY upper(t.telphin_call_id),
              COALESCE(t.duration_sec, 0) DESC,
              (t.recording_url IS NOT NULL) DESC
),
privyazka AS (
    -- Одна привязка на звонок: самая надёжная из имеющихся.
    SELECT DISTINCT ON (upper(m.telphin_call_id))
           upper(m.telphin_call_id) AS call_key,
           m.retailcrm_order_id     AS order_id,
           m.match_type,
           m.explanation
      FROM public.call_order_matches m
     WHERE m.match_type <> 'ai_suggested'
     ORDER BY upper(m.telphin_call_id),
              CASE m.match_type
                  WHEN 'okk_card'  THEN 1
                  WHEN 'manual'    THEN 2
                  WHEN 'okk_auto'  THEN 3
                  WHEN 'retailcrm' THEN 4
                  ELSE 9
              END,
              m.matched_at DESC
)
SELECT z.telphin_call_id,
       p.order_id,
       z.started_at,
       z.duration_sec,
       z.direction,
       z.manager_id,
       -- Кто установил связь: мы, RetailCRM или старый матчинг по телефону.
       CASE
           WHEN p.match_type IN ('okk_card', 'manual', 'okk_auto') THEN 'own'
           WHEN p.match_type = 'retailcrm' THEN 'crm'
           ELSE 'match'
       END AS source,
       p.match_type,
       p.explanation,
       r.answered
  FROM zvonok z
  JOIN privyazka p ON p.call_key = z.call_key
  JOIN razgovor r ON r.telphin_call_id = z.telphin_call_id

UNION ALL

-- Привязка RetailCRM из её собственной выгрузки телефонии: связь идёт через
-- идентификатор ЗАПИСИ, в матчинге её нет. Берём только то, про что мы ещё не
-- знаем сами.
SELECT t.telphin_call_id,
       o.id        AS order_id,
       c.call_date AS started_at,
       c.duration_sec,
       CASE WHEN c.call_type = 'in' THEN 'incoming' ELSE 'outgoing' END AS direction,
       nullif(c.manager_rc_id, '')::bigint AS manager_id,
       'crm'::text AS source,
       'retailcrm'::text AS match_type,
       'Привязка к заказу сделана в RetailCRM'::text AS explanation,
       r.answered
  FROM public.retailcrm_calls c
  JOIN public.orders o ON o.number = c.order_number
  JOIN public.raw_telphin_calls t ON c.external_id = ANY (t.record_uuids)
  JOIN razgovor r ON r.telphin_call_id = t.telphin_call_id
 WHERE c.order_number IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM public.call_order_matches m
         WHERE upper(m.telphin_call_id) = upper(t.telphin_call_id)
           AND m.match_type <> 'ai_suggested'
   );

COMMENT ON VIEW public.call_order_link IS
    'Звонок ↔ заказ. source=own — привязали в ОКК (match_type: okk_card/manual/okk_auto), crm — RetailCRM, match — старый матчинг по телефону (ошибается ~30%, новых не делаем). answered=false — разговора с клиентом не было.';
