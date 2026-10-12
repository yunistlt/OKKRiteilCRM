-- История статуса — с кодом, как писала синхронизация RetailCRM.
--
-- Владелец 12.10.2026: «почему не актуальные данные, может из-за того что мы
-- отключились от ритейла, а на наш ОКК не переделали». Так и есть: расчёт
-- зарплаты ищет вход заказа в производство по КОДУ статуса внутри истории
-- (`new_value LIKE '%"code":"send-assembling"%'`). Пока статусы меняли в
-- RetailCRM, код там был. Когда заказы стали вести только у нас, в историю
-- писалось одно название — и переходы перестали считаться: за октябрь в
-- выручку отдела попали 4 заказа из 91.
--
-- 1. Переписываем уже записанные названия в формат {"code","name"} по
--    справочнику статусов. Записи «null» (11 594 штуки, старый мусор синка)
--    не трогаем: кода у них нет и не было.
UPDATE public.order_history_log h
   SET new_value = jsonb_build_object('code', d.item_code, 'name', d.item_name)::text
  FROM public.retailcrm_dictionaries d
 WHERE h.field = 'status'
   AND h.new_value IS NOT NULL
   AND h.new_value NOT LIKE '{%'
   AND d.entity_type = 'status'
   AND d.item_name = h.new_value;

UPDATE public.order_history_log h
   SET old_value = jsonb_build_object('code', d.item_code, 'name', d.item_name)::text
  FROM public.retailcrm_dictionaries d
 WHERE h.field = 'status'
   AND h.old_value IS NOT NULL
   AND h.old_value NOT LIKE '{%'
   AND d.entity_type = 'status'
   AND d.item_name = h.old_value;

-- 2. Дата входа в текущий статус: у заказов, заведённых у нас, колонка пустая,
--    и их не видят ни зарплата, ни «зависшие сделки». Берём момент последней
--    смены статуса из истории, а если её нет — дату создания заказа.
UPDATE public.orders o
   SET status_since = COALESCE(last_move.moved_at, o.created_at)
  FROM (
        SELECT h.retailcrm_order_id AS oid, max(h.occurred_at) AS moved_at
          FROM public.order_history_log h
         WHERE h.field = 'status'
         GROUP BY h.retailcrm_order_id
       ) AS last_move
 WHERE o.status_since IS NULL
   AND last_move.oid = o.order_id;

UPDATE public.orders
   SET status_since = created_at
 WHERE status_since IS NULL AND created_at IS NOT NULL;

-- 3. Тот же момент в снимке заказа: по нему расчёт зарплаты определяет период
--    начисления, когда истории статусов нет вовсе.
UPDATE public.orders
   SET raw_payload = jsonb_set(raw_payload, '{statusUpdatedAt}', to_jsonb(status_since))
 WHERE order_id >= 900000000
   AND status_since IS NOT NULL
   AND (raw_payload->>'statusUpdatedAt') IS NULL;
