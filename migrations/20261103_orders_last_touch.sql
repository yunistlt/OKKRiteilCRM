-- Последнее касание заказа: одно определение на систему.
--
-- Ирина Гордеева 03.11.2026 (доработка №76): «Указано, что нет движения
-- 6 дней, дозвон был вчера т.е 02.11 и стоит созвон на пятницу 06.11».
--
-- Строку «Нет движения N дн.» рисует «Мой день», и он считал её по
-- `orders.status_since` — сколько заказ стоит в статусе. Звонок, письмо и
-- комментарий статус не меняют, поэтому работа по заказу этот счётчик не
-- сбрасывала: менеджер говорил с клиентом вчера, а экран писал «нет движения
-- 6 дней». Бот-РОП в тех же днях считает иначе — по последнему касанию
-- (`sales_rop_presale_orders.last_touch_at`), и расходился с экраном.
--
-- Теперь касание считается в одном месте. Выражение то же, что у бота:
-- правка заказа (`orders.updated_at`) или любая запись в истории заказа —
-- комментарий, смена статуса, перенос даты. Что из касаний закрывает задачу
-- дня — отдельный вопрос и отдельное правило (`lib/sales-rop/touch-rules.ts`).
--
-- Звонков здесь нет: разговор попадает в историю комментарием менеджера, а
-- привязка «звонок — заказ» живёт своей таблицей и считается отдельно
-- (`sales_rop_touches`). Смешивать их в одном числе не нужно: «нет движения»
-- отвечает на вопрос «давно ли трогали карточку».
--
-- Аддитивно: новые функции, существующие не меняются.

CREATE OR REPLACE FUNCTION public.order_last_touch_at(p_order_id bigint)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $function$
    SELECT GREATEST(
               o.updated_at,
               coalesce(
                   (SELECT max(h.occurred_at)
                      FROM public.order_history_log h
                     WHERE h.retailcrm_order_id = o.order_id),
                   o.updated_at
               )
           )
      FROM public.orders o
     WHERE o.order_id = p_order_id;
$function$;

COMMENT ON FUNCTION public.order_last_touch_at(bigint) IS
    'Когда заказ последний раз трогали: правка заказа или запись в истории (комментарий, статус, дата контакта).';

-- Пачкой: экран спрашивает про свои заказы разом, а не по одному.
-- Запрос идёт по индексам unique_order_id и idx_order_history_order_time.
CREATE OR REPLACE FUNCTION public.orders_last_touch(p_order_ids bigint[])
RETURNS TABLE(order_id bigint, last_touch_at timestamptz)
LANGUAGE sql
STABLE
AS $function$
    SELECT o.order_id, public.order_last_touch_at(o.order_id)
      FROM public.orders o
     WHERE o.order_id = ANY(p_order_ids);
$function$;

GRANT EXECUTE ON FUNCTION public.order_last_touch_at(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.orders_last_touch(bigint[]) TO service_role;

NOTIFY pgrst, 'reload config';
