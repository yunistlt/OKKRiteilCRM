-- История своих заказов.
--
-- `order_history_log` наполняла только синхронизация RetailCRM, поэтому у
-- заказов, созданных у нас, история была пустой: «Изменений по заказу пока не
-- записано» в карточке 1020А, хотя заказ только что создан (замечание
-- владельца 02.10.2026: «создан новый заказ — это уже история, сделай 1 в 1
-- как в ритейле»).
--
-- Свои записи истории нумеруем из отдельного счётчика: `retailcrm_history_id`
-- уникален и у приехавших из RetailCRM занят её номерами.
CREATE SEQUENCE IF NOT EXISTS public.own_order_history_seq START 900000000;

COMMENT ON SEQUENCE public.own_order_history_seq IS
  'Номера записей истории, созданных в нашей CRM: свой диапазон, не пересекается с RetailCRM';

CREATE OR REPLACE FUNCTION public.next_own_history_ids(count_needed INTEGER)
RETURNS SETOF BIGINT
LANGUAGE sql
AS $$ SELECT nextval('public.own_order_history_seq') FROM generate_series(1, GREATEST(count_needed, 0)) $$;

COMMENT ON FUNCTION public.next_own_history_ids(INTEGER) IS
  'Выдаёт номера для записей истории своих заказов';
