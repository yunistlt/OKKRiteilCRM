-- Оплата разносится в заказ ОКК, а не в RetailCRM (решение владельца 15.10.2026).
--
-- Было: платёж из банка проводился методом RetailCRM `orders/payments/create`, и
-- факт проводки хранился в `retailcrm_synced_at` / `retailcrm_error`. С переходом
-- на свою CRM (RetailCRM — архив на чтение) оплата пишется в `order_payments`
-- со `source = 'okk'`, и прежние имена колонок стали врать.
--
-- Новые колонки говорят то, что есть: когда оплата разнесена в заказ у нас и
-- почему не разнеслась. Старые оставлены как история проводок до 15.10.2026 —
-- удалять их отдельным шагом, когда никому не понадобятся.

ALTER TABLE public.point_payments ADD COLUMN IF NOT EXISTS posted_at timestamptz;
ALTER TABLE public.point_payments ADD COLUMN IF NOT EXISTS posting_error text;

COMMENT ON COLUMN public.point_payments.posted_at IS
    'Когда оплата разнесена в заказ ОКК (строка в order_payments, source = okk).';
COMMENT ON COLUMN public.point_payments.posting_error IS
    'Почему оплату не удалось разнести в заказ ОКК. NULL — разнесена или ещё не пробовали.';

-- История: раньше факт проводки лежал в этих колонках, переносим как есть.
UPDATE public.point_payments
   SET posted_at = retailcrm_synced_at
 WHERE posted_at IS NULL AND retailcrm_synced_at IS NOT NULL;

UPDATE public.point_payments
   SET posting_error = retailcrm_error
 WHERE posting_error IS NULL AND retailcrm_error IS NOT NULL;

COMMENT ON COLUMN public.point_payments.retailcrm_synced_at IS
    'УСТАРЕЛО (15.10.2026): проводка в RetailCRM. Актуальное поле — posted_at.';
COMMENT ON COLUMN public.point_payments.retailcrm_error IS
    'УСТАРЕЛО (15.10.2026): ошибка проводки в RetailCRM. Актуальное поле — posting_error.';
COMMENT ON COLUMN public.point_payments.retailcrm_payment_id IS
    'УСТАРЕЛО (15.10.2026): id платежа в RetailCRM. Оплаты туда больше не уходят.';
COMMENT ON COLUMN public.point_payments.crm_posting IS
    'УСТАРЕЛО (15.10.2026): состояние проводки в RetailCRM, сверка выключена.';
COMMENT ON COLUMN public.point_payments.posting_checked_at IS
    'УСТАРЕЛО (15.10.2026): время сверки проводки с RetailCRM, сверка выключена.';

CREATE INDEX IF NOT EXISTS point_payments_not_posted
    ON public.point_payments (status)
    WHERE posted_at IS NULL;
