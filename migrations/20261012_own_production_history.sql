-- Дописать переход в производство тем своим заказам, где его перевела оплата.
--
-- Перевод после оплаты шёл прямым UPDATE: колонка статуса менялась, а записи в
-- истории не было. Для расчёта зарплаты такой заказ не существует — он ищет
-- вход в производство по истории. Из-за этого три октябрьских заказа (900042,
-- 900050, 900073) не попали ни в выручку, ни в конверсию.
--
-- Код починен (перевод идёт через editOrder), здесь — разовая дозапись. Дата
-- перехода — момент, когда автоматика его сделала (orders.updated_at).
--
-- Трогаем ТОЛЬКО свои заказы (order_id >= 900 000 000). У приехавших из
-- RetailCRM похожие пробелы относятся к прошлым периодам: дозапись задним
-- числом сдвинула бы уже закрытые ведомости.

WITH missing AS (
    SELECT o.order_id,
           COALESCE(o.updated_at, o.status_since, o.created_at) AS moved_at
      FROM public.orders o
     WHERE o.order_id >= 900000000
       AND o.status = 'send-assembling'
       AND NOT EXISTS (
            SELECT 1 FROM public.order_history_log h
             WHERE h.retailcrm_order_id = o.order_id
               AND h.field = 'status'
               AND h.new_value LIKE '%"code":"send-assembling"%'
       )
)
INSERT INTO public.order_history_log (retailcrm_history_id, retailcrm_order_id, field, old_value, new_value, occurred_at)
SELECT nextval('public.own_order_history_seq'),
       m.order_id,
       'status',
       NULL,
       jsonb_build_object('code', 'send-assembling', 'name', 'Передано в производство')::text,
       m.moved_at
  FROM missing m;

-- Дата входа в статус — тот же момент.
UPDATE public.orders o
   SET status_since = COALESCE(o.updated_at, o.status_since),
       raw_payload = jsonb_set(o.raw_payload, '{statusUpdatedAt}', to_jsonb(COALESCE(o.updated_at, o.status_since)))
 WHERE o.order_id >= 900000000
   AND o.status = 'send-assembling';
