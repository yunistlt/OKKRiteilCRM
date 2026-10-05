-- ============================================================================
-- Привязка звонка к заказу, сделанная нами, а не угаданная.
--
-- Решение владельца 05.10.2026: входящий звонок тоже должен знать свой заказ.
-- Из номера это не следует: на живых входящих за две недели клиент нашёлся у
-- 11 номеров из 40, и даже у найденного обычно 2–5 заказов. Поэтому привязка
-- либо точная, либо её нет — угадывать больше не будем.
--
-- Способы (колонка method), от надёжного к слабому:
--   card   — набран из карточки заказа, заказ известен в момент набора;
--   manual — менеджер указал заказ руками во время или сразу после разговора;
--   auto   — клиент однозначно определён по номеру и у него РОВНО ОДИН
--            открытый заказ; других толкований нет;
--   ai     — предложено по расшифровке разговора; показывается как подсказка и
--            становится привязкой только после подтверждения человеком
--            (status='confirmed').
--
-- Идентификатор звонка хранится прописными: Телфин отдаёт его прописными, а на
-- набор из карточки возвращает строчными, и один разговор расходился на две
-- строки (вскрыто 05.10.2026).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.call_order_bindings (
    call_key    text PRIMARY KEY,
    order_id    bigint NOT NULL,
    method      text NOT NULL CHECK (method IN ('card', 'manual', 'auto', 'ai')),
    status      text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'suggested')),
    -- Кто привязал: логин человека либо имя механизма.
    bound_by    text,
    -- Чем обосновано — человеку должно быть видно, откуда взялась привязка.
    reason      text,
    bound_at    timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.call_order_bindings IS
    'Звонок ↔ заказ, установленный нами: из карточки, руками менеджера, строгим автоматом или подсказкой ИИ после подтверждения. Ключ — идентификатор звонка ПРОПИСНЫМИ.';

CREATE INDEX IF NOT EXISTS idx_call_order_bindings_order ON public.call_order_bindings (order_id);
CREATE INDEX IF NOT EXISTS idx_call_order_bindings_status ON public.call_order_bindings (status) WHERE status = 'suggested';

-- Переносим то, что уже известно: звонки, набранные из карточки заказа.
INSERT INTO public.call_order_bindings (call_key, order_id, method, status, bound_by, reason)
SELECT DISTINCT ON (upper(t.telphin_call_id))
       upper(t.telphin_call_id),
       o.id,
       'card',
       'confirmed',
       'ОКК',
       'Набран из карточки заказа'
  FROM public.raw_telphin_calls t
  JOIN public.orders o ON o.id::text = (t.raw_payload ->> 'order_id')
 WHERE t.raw_payload ->> 'order_id' IS NOT NULL
 ORDER BY upper(t.telphin_call_id), t.ingested_at DESC
ON CONFLICT (call_key) DO NOTHING;

-- ============================================================================
-- Связь звонка с заказом: наша привязка главнее всего, матчинг — последний.
-- ============================================================================
-- Колонок стало больше, порядок меняется — CREATE OR REPLACE такого не умеет.
DROP VIEW IF EXISTS public.call_order_link;
CREATE VIEW public.call_order_link AS
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
nash AS (
    -- Подтверждённые привязки. Подсказки ИИ сюда не попадают.
    SELECT b.call_key, b.order_id, b.method
      FROM public.call_order_bindings b
     WHERE b.status = 'confirmed'
),
nash_call AS (
    -- Из двух строк одного разговора берём ту, где есть сам разговор.
    SELECT DISTINCT ON (upper(t.telphin_call_id))
           t.telphin_call_id,
           upper(t.telphin_call_id) AS call_key,
           t.started_at,
           t.duration_sec,
           t.direction,
           nullif(t.raw_payload ->> 'manager_id', '')::bigint AS manager_id
      FROM public.raw_telphin_calls t
     WHERE upper(t.telphin_call_id) IN (SELECT call_key FROM nash)
     ORDER BY upper(t.telphin_call_id),
              COALESCE(t.duration_sec, 0) DESC,
              (t.recording_url IS NOT NULL) DESC
)

-- Привязали мы сами: карточка, менеджер, строгий автомат, подтверждённая подсказка.
SELECT k.telphin_call_id,
       n.order_id,
       k.started_at,
       k.duration_sec,
       k.direction,
       k.manager_id,
       'own'::text  AS source,
       n.method,
       r.answered
  FROM nash_call k
  JOIN nash n ON n.call_key = k.call_key
  JOIN razgovor r ON r.telphin_call_id = k.telphin_call_id

UNION ALL

-- Привязку сделала RetailCRM — пока работа идёт и там.
SELECT t.telphin_call_id,
       o.id                AS order_id,
       c.call_date         AS started_at,
       c.duration_sec,
       CASE WHEN c.call_type = 'in' THEN 'incoming' ELSE 'outgoing' END AS direction,
       nullif(c.manager_rc_id, '')::bigint AS manager_id,
       'crm'::text         AS source,
       'retailcrm'::text   AS method,
       r.answered
  FROM public.retailcrm_calls c
  JOIN public.orders o ON o.number = c.order_number
  JOIN public.raw_telphin_calls t ON c.external_id = ANY (t.record_uuids)
  JOIN razgovor r ON r.telphin_call_id = t.telphin_call_id
 WHERE c.order_number IS NOT NULL
   AND upper(t.telphin_call_id) NOT IN (SELECT call_key FROM nash)

UNION ALL

-- Костыль: наш матчинг по телефону. Только там, где ни ОКК, ни CRM не знают.
SELECT m.telphin_call_id,
       m.retailcrm_order_id AS order_id,
       t.started_at,
       t.duration_sec,
       t.direction,
       NULL::bigint         AS manager_id,
       'match'::text        AS source,
       'phone'::text        AS method,
       r.answered
  FROM public.call_order_matches m
  JOIN public.raw_telphin_calls t ON t.telphin_call_id = m.telphin_call_id
  JOIN razgovor r ON r.telphin_call_id = t.telphin_call_id
 WHERE upper(t.telphin_call_id) NOT IN (SELECT call_key FROM nash)
   AND NOT EXISTS (
        SELECT 1
          FROM public.retailcrm_calls c2
          JOIN public.orders o2 ON o2.number = c2.order_number
         WHERE o2.id = m.retailcrm_order_id
           AND c2.order_number IS NOT NULL
       );

COMMENT ON VIEW public.call_order_link IS
    'Звонок ↔ заказ. source=own — привязали мы (method: card/manual/auto/ai), crm — привязка RetailCRM, match — наш матчинг по телефону (запасной, ошибается ~30%). answered=false — разговора с клиентом не было: автодозвон, автоответчик, сброс.';
