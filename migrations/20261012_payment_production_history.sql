-- Дозапись входа в производство для заказов, которые перевела оплата.
--
-- Перевод после полной (или 70%) оплаты шёл прямым UPDATE: статус менялся, а
-- записи в истории не было. Расчёт зарплаты ищет вход в производство по
-- истории, поэтому такие заказы не считались ни в выручке, ни в конверсии.
--
-- Сверка 12.10.2026: в октябре так потерялись 10 заказов на 2,57 млн ₽ —
-- 54131, 54932, 54665, 54301, 53666, 53058, 54855, 54776, 54632, 53508.
--
-- Дата входа — момент разноса оплаты (own_order_payments.created_at): именно
-- он двигал статус, и `orders.updated_at` совпадает с ним до секунды.
--
-- Берём ТОЛЬКО такие заказы: статус «передано в производство», записи о входе
-- нет, разнос оплаты совпадает с последним изменением заказа. Старые хвосты
-- (13 заказов 2024–2025 годов без оплат) не трогаем: их периоды давно закрыты.

WITH moved_by_payment AS (
    SELECT o.order_id,
           max(p.created_at) AS paid_at
      FROM public.orders o
      JOIN public.own_order_payments p ON p.order_number = o.number
     WHERE o.status = 'send-assembling'
       AND NOT EXISTS (
            SELECT 1 FROM public.order_history_log h
             WHERE h.retailcrm_order_id = o.order_id
               AND h.field = 'status'
               AND h.new_value LIKE '%"code":"send-assembling"%'
       )
     GROUP BY o.order_id, o.updated_at
    HAVING abs(extract(epoch FROM (o.updated_at - max(p.created_at)))) < 60
)
INSERT INTO public.order_history_log (retailcrm_history_id, retailcrm_order_id, field, old_value, new_value, occurred_at)
SELECT nextval('public.own_order_history_seq'),
       m.order_id,
       'status',
       NULL,
       '{"code":"send-assembling","name":"Передано в производство"}',
       m.paid_at
  FROM moved_by_payment m;

-- Дата входа в статус — тот же момент.
UPDATE public.orders o
   SET status_since = h.occurred_at
  FROM public.order_history_log h
 WHERE h.retailcrm_order_id = o.order_id
   AND h.field = 'status'
   AND h.new_value LIKE '%"code":"send-assembling"%'
   AND o.status = 'send-assembling'
   AND (o.status_since IS NULL OR o.status_since < h.occurred_at);
