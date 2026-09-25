-- Одна связь «звонок ↔ заказ» на весь проект.
--
-- Источников два, и они неравноценны. RetailCRM знает привязку точно: она
-- сделана в карточке заказа, там же, где работает менеджер. Наш матчинг по
-- номеру телефона её угадывает и ошибается примерно в трети случаев — на 22
-- сентября он «нашёл» звонки по 79 заказам там, где CRM знает про 56.
--
-- Полтора десятка мест в коде джойнили call_order_matches напрямую. Переписать
-- каждое отдельно значило бы получить полтора десятка разных пониманий того,
-- что считается звонком по заказу. Поэтому связь одна и лежит в базе: код
-- джойнит её, а какой источник главный, решается здесь.
--
-- Связь с записью разговора неочевидная: RetailCRM отдаёт идентификатор ЗАПИСИ
-- (external_id вида «469589-b5046344…»), а он лежит внутри массива record_uuids
-- в выгрузке Телфина. По telphin_call_id они не сходятся вовсе. Сходится 13 571
-- звонок из 18 909, и почти все они с расшифровкой.

-- Массив записей ищется по вхождению — без индекса это перебор всей таблицы.
CREATE INDEX IF NOT EXISTS idx_raw_telphin_record_uuids
    ON public.raw_telphin_calls USING gin (record_uuids);

CREATE INDEX IF NOT EXISTS idx_retailcrm_calls_order_number
    ON public.retailcrm_calls (order_number)
    WHERE order_number IS NOT NULL;

CREATE OR REPLACE VIEW public.call_order_link AS
-- Главный источник: привязку сделала CRM.
SELECT t.telphin_call_id,
       o.id                AS order_id,
       c.call_date         AS started_at,
       c.duration_sec,
       CASE WHEN c.call_type = 'in' THEN 'incoming' ELSE 'outgoing' END AS direction,
       -- В выгрузке CRM идентификатор менеджера строкой; приводим к числу,
       -- чтобы связь джойнилась с managers, как остальной код.
       nullif(c.manager_rc_id, '')::bigint AS manager_id,
       'crm'::text         AS source
  FROM public.retailcrm_calls c
  JOIN public.orders o ON o.number = c.order_number
  JOIN public.raw_telphin_calls t ON c.external_id = ANY (t.record_uuids)
 WHERE c.order_number IS NOT NULL

UNION ALL

-- Костыль: наш матчинг. Только для заказов, про которые CRM промолчала, —
-- иначе один разговор пришёл бы дважды и удвоил бы активность.
SELECT m.telphin_call_id,
       m.retailcrm_order_id AS order_id,
       t.started_at,
       t.duration_sec,
       t.direction,
       NULL::bigint         AS manager_id,
       'match'::text        AS source
  FROM public.call_order_matches m
  JOIN public.raw_telphin_calls t ON t.telphin_call_id = m.telphin_call_id
 WHERE NOT EXISTS (
        SELECT 1
          FROM public.retailcrm_calls c2
          JOIN public.orders o2 ON o2.number = c2.order_number
         WHERE o2.id = m.retailcrm_order_id
           AND c2.order_number IS NOT NULL
       );

COMMENT ON VIEW public.call_order_link IS
    'Звонок ↔ заказ. source=crm — привязка из RetailCRM (точная), source=match — наш матчинг по телефону (запасной, ошибается ~30%). Время — время разговора, а не сопоставления.';
