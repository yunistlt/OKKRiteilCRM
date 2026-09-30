-- Повторы проводки платежа: помним попытки и не шлём одно и то же уведомление.
--
-- Инцидент 30.09.2026: RetailCRM перестала принимать магазин zmktlt-ru, и
-- проводка платежей по заказам этого магазина стала падать. Платёж при этом не
-- терялся — крон повторяет его каждые несколько минут, — но при каждой попытке
-- уходило сообщение «Оплата не проведена в CRM». Человек видел поток
-- одинаковых сообщений и не понимал, надо ли что-то делать.
--
-- Колонки только добавляются.

ALTER TABLE public.point_payments
    ADD COLUMN IF NOT EXISTS push_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS push_error_notified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS push_error_last TEXT;

COMMENT ON COLUMN public.point_payments.push_attempts IS
  'Сколько раз пробовали провести платёж в RetailCRM';
COMMENT ON COLUMN public.point_payments.push_error_notified_at IS
  'Когда в последний раз сообщали человеку о сбое проводки';
COMMENT ON COLUMN public.point_payments.push_error_last IS
  'Текст последней ошибки — чтобы не слать одно и то же дважды';
