-- Момент входа заказа в текущий статус.
--
-- Без него «сколько заказ висит в статусе» считается только для видимой страницы:
-- поднять историю по всем 30 тысячам заказов на каждый фильтр нельзя. Держим значение
-- в самом заказе — тогда просрочку можно искать по всей базе одним запросом.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_status_since ON public.orders(status, status_since);

COMMENT ON COLUMN public.orders.status_since IS 'Когда заказ вошёл в текущий статус (из order_history_log)';
