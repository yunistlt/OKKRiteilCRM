-- Номер для оплаты, внесённой у нас. `order_payments.id` — идентификатор платежа
-- RetailCRM, своей нумерации у таблицы нет; свои берём из диапазона 900 000 000+,
-- как и номера своих заказов. Через REST-клиент nextval не вызвать — нужна функция.
CREATE OR REPLACE FUNCTION public.next_own_payment_id()
RETURNS bigint
LANGUAGE sql
AS $$ SELECT nextval('public.own_order_payment_seq') $$;
