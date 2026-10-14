-- ============================================================================
-- Оплата заказа — одна таблица: public.order_payments.
--
-- Повод 14.10.2026: владелец сверял октябрьскую зарплату и увидел «средний %
-- предоплаты 4 %» при 11 заказах, оплаченных на 60–100 %. Причина — оплата
-- хранилась в ДВУХ местах. `order_payments` собирается из снимка RetailCRM, и
-- там лежат только ВЫСТАВЛЕННЫЕ счета (status = NULL). Реальные поступления,
-- разнесённые в ОКК, писались в отдельную `own_order_payments`, которую расчёт
-- предоплаты не читал. Из 11 заказов в показатель попал ровно один — 54820,
-- единственный, чей платёж приехал из банковского обмена.
--
-- Решение владельца: свести всё в одну таблицу, а источник помечать столбцом.
-- Столбец для этого уже есть — `source` ('crm' / 'okk', миграция 06.10.2026),
-- новый не заводим. Добавляем только те поля разноса, которых в таблице нет.
--
-- `order_number` НЕ переносим: это копия `orders.number`, доступная по
-- `order_id` (закон об одном источнике правды).
-- ============================================================================

ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS payer_name text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE public.order_payments ADD COLUMN IF NOT EXISTS point_payment_id bigint;

COMMENT ON COLUMN public.order_payments.method IS 'Способ оплаты при разносе у нас (например «Банковский перевод»).';
COMMENT ON COLUMN public.order_payments.payer_name IS 'Плательщик из банковской выписки.';
COMMENT ON COLUMN public.order_payments.purpose IS 'Назначение платежа из банковской выписки.';
COMMENT ON COLUMN public.order_payments.point_payment_id IS
    'Идентификатор поступления в банковском обмене: по нему один платёж не проводится дважды.';

-- Один банковский платёж — одна строка.
CREATE UNIQUE INDEX IF NOT EXISTS order_payments_point_payment
    ON public.order_payments (point_payment_id)
 WHERE point_payment_id IS NOT NULL;

-- Свои оплаты нумеруем из диапазона 900 000 000+, как и свои заказы: `id`
-- у таблицы — идентификатор платежа RetailCRM, своей нумерации не было, и три
-- строки разбора 06.10.2026 завели руками (900000001–900000003).
CREATE SEQUENCE IF NOT EXISTS public.own_order_payment_seq START 900000000;
SELECT setval('public.own_order_payment_seq',
              GREATEST(900000000, (SELECT COALESCE(max(id), 0) FROM public.order_payments WHERE id >= 900000000)));
