-- ============================================================================
-- Звонок ↔ заказ: своя привязка главнее, и разговор отличается от дозвона.
--
-- Два закона владельца от 05.10.2026:
--
-- 1. «Мы уже ничего не матчим». Привязка должна приходить вместе со звонком.
--    Когда менеджер звонит из карточки заказа в ОКК, номер заказа известен в
--    момент набора и лежит в `raw_telphin_calls.raw_payload->>'order_id'`.
--    Связь его не читала, поэтому свой же звонок всё равно попадал в ветку
--    матчинга по телефону. Теперь это источник `own` — выше RetailCRM.
--
--    Отдельная засада, из-за которой привязка терялась: Телфин отдаёт
--    `call_uuid` ПРОПИСНЫМИ, а на набор из карточки возвращает те же 32 знака
--    строчными, и один разговор лежал двумя строками — наша с номером заказа,
--    но пустая, и телфинская с записью, но без заказа. Здесь они сводятся по
--    идентификатору без учёта регистра; на будущее набор из карточки пишет
--    идентификатор прописными (app/api/calls/initiate).
--
-- 2. «Звонок считается состоявшимся, когда был разговор с клиентом. Никаких
--    автодозвонов, никаких автоответчиков». Телфин отдаёт попытку дозвона как
--    answered с ненулевой длительностью: у звонка по заказу 39775 верхний
--    уровень говорил «48 секунд», а единственное плечо — failed, 0 секунд, без
--    записи. За 90 дней таких 417 из 6 927. Поэтому у связи появилось поле
--    `answered`: разговор был, если хоть одно плечо разговаривало или осталась
--    запись (записи без говорящего плеча — 6 штук за 90 дней, это погрешность).
--
-- Состав строк не меняется: добавлен источник `own` и колонка `answered`.
-- Кто считает звонки активностью — решает сам, что делать с `answered`.
-- ============================================================================

-- Свои звонки ищутся по order_id внутри ответа — без индекса это перебор.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_payload_order
    ON public.raw_telphin_calls (((raw_payload ->> 'order_id')))
    WHERE raw_payload ->> 'order_id' IS NOT NULL;

-- Сведение двойников идёт по идентификатору без регистра.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_call_id_upper
    ON public.raw_telphin_calls ((upper(telphin_call_id)));

CREATE OR REPLACE VIEW public.call_order_link AS
WITH razgovor AS (
    -- Разговор с клиентом: хоть одно плечо говорило либо осталась запись.
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
own_order AS (
    -- Номер заказа, названный при наборе из карточки. Ключ без регистра.
    SELECT DISTINCT ON (upper(t.telphin_call_id))
           upper(t.telphin_call_id) AS call_key,
           (t.raw_payload ->> 'order_id') AS order_ref,
           nullif(t.raw_payload ->> 'manager_id', '')::bigint AS manager_id
      FROM public.raw_telphin_calls t
     WHERE t.raw_payload ->> 'order_id' IS NOT NULL
     ORDER BY upper(t.telphin_call_id), t.ingested_at DESC
),
own_call AS (
    -- Из двух строк одного разговора берём ту, где есть сам разговор.
    SELECT DISTINCT ON (upper(t.telphin_call_id))
           t.telphin_call_id,
           upper(t.telphin_call_id) AS call_key,
           t.started_at,
           t.duration_sec,
           t.direction
      FROM public.raw_telphin_calls t
     WHERE upper(t.telphin_call_id) IN (SELECT call_key FROM own_order)
     ORDER BY upper(t.telphin_call_id),
              COALESCE(t.duration_sec, 0) DESC,
              (t.recording_url IS NOT NULL) DESC
)

-- Самый точный источник: звонок набран из карточки заказа в ОКК.
SELECT k.telphin_call_id,
       o.id            AS order_id,
       k.started_at,
       k.duration_sec,
       k.direction,
       n.manager_id,
       'own'::text     AS source,
       r.answered
  FROM own_call k
  JOIN own_order n ON n.call_key = k.call_key
  JOIN razgovor r ON r.telphin_call_id = k.telphin_call_id
  JOIN public.orders o ON o.id::text = n.order_ref

UNION ALL

-- Привязку сделала RetailCRM — пока работа идёт и там.
SELECT t.telphin_call_id,
       o.id                AS order_id,
       c.call_date         AS started_at,
       c.duration_sec,
       CASE WHEN c.call_type = 'in' THEN 'incoming' ELSE 'outgoing' END AS direction,
       nullif(c.manager_rc_id, '')::bigint AS manager_id,
       'crm'::text         AS source,
       r.answered
  FROM public.retailcrm_calls c
  JOIN public.orders o ON o.number = c.order_number
  JOIN public.raw_telphin_calls t ON c.external_id = ANY (t.record_uuids)
  JOIN razgovor r ON r.telphin_call_id = t.telphin_call_id
 WHERE c.order_number IS NOT NULL
   AND upper(t.telphin_call_id) NOT IN (SELECT call_key FROM own_order)

UNION ALL

-- Костыль: наш матчинг по телефону. Только там, где ни ОКК, ни CRM не знают, —
-- иначе один разговор пришёл бы дважды и удвоил бы активность.
SELECT m.telphin_call_id,
       m.retailcrm_order_id AS order_id,
       t.started_at,
       t.duration_sec,
       t.direction,
       NULL::bigint         AS manager_id,
       'match'::text        AS source,
       r.answered
  FROM public.call_order_matches m
  JOIN public.raw_telphin_calls t ON t.telphin_call_id = m.telphin_call_id
  JOIN razgovor r ON r.telphin_call_id = t.telphin_call_id
 WHERE upper(t.telphin_call_id) NOT IN (SELECT call_key FROM own_order)
   AND NOT EXISTS (
        SELECT 1
          FROM public.retailcrm_calls c2
          JOIN public.orders o2 ON o2.number = c2.order_number
         WHERE o2.id = m.retailcrm_order_id
           AND c2.order_number IS NOT NULL
       );

COMMENT ON VIEW public.call_order_link IS
    'Звонок ↔ заказ. source=own — набран из карточки заказа в ОКК (точно), crm — привязка RetailCRM, match — наш матчинг по телефону (запасной, ошибается ~30%). answered=false — разговора с клиентом не было: автодозвон, автоответчик, сброс.';
