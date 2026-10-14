-- ============================================================================
-- Перенос разнесённых оплат из `own_order_payments` в `order_payments`.
-- Продолжение 20261014_payments_single_table.sql: одна таблица на оплату.
--
-- Сверка 14.10.2026 по каждой из 23 строк: номер заказа совпадает с order_id,
-- сумма не превышает сумму заказа, ни у одного заказа ещё нет строки source =
-- 'okk', все point_payment_id различны.
--
-- Отдельно проверено задвоение: у пяти заказов (54132, 54151, 54453, 54521,
-- 54566) есть и банковская оплата из RetailCRM. Это НЕ дубли — все 23 заказа
-- помечены is_own, а разнос по своему заказу в RetailCRM не отправляется
-- (lib/payments/service.ts). Суммы складываются в правдоподобную картину:
-- 54453 — 308 750 в сентябре и 308 750 в октябре, ровно сумма заказа.
--
-- Статус ставим 'paid': разнос вносят, УВИДЕВ деньги на счёте, а не выставив
-- счёт. Тип оплаты у разноса не задаётся — оставляем пустым, не выдумываем.
-- ============================================================================

INSERT INTO public.order_payments
    (id, order_id, "type", "status", amount, "paidAt", "comment", "externalId",
     source, note, created_by, method, payer_name, purpose, point_payment_id, updated_at)
SELECT nextval('public.own_order_payment_seq'),
       w.order_id, NULL, 'paid', w.amount, w.paid_at::timestamptz, NULL, NULL,
       'okk', w.note, w.created_by, w.method, w.payer_name, w.purpose,
       w.point_payment_id, w.created_at
  FROM public.own_order_payments w
 WHERE NOT EXISTS (
        SELECT 1 FROM public.order_payments p
         WHERE p.point_payment_id IS NOT NULL
           AND p.point_payment_id = w.point_payment_id
 );

COMMENT ON TABLE public.own_order_payments IS
    'АРХИВ. Оплата заказа живёт в public.order_payments (source = okk), сюда больше не пишем. Перенос 14.10.2026.';
