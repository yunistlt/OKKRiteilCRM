-- Свои заказы: живут только у нас, в RetailCRM не уходят.
--
-- Решение владельца 30.09.2026: переводим одного менеджера целиком на нашу базу.
-- Его заказы создаются здесь, здесь же ведутся, в RetailCRM не отправляются.
-- Остальные менеджеры продолжают работать как раньше — их это не касается.
--
-- Что понадобилось:
--   * флаг «наш заказ», чтобы часовая сверка с RetailCRM не пометила такие
--     заказы удалёнными (она считает удалённым всё, чего нет в CRM);
--   * свой счётчик номеров с буквой «А» на конце — чтобы номера не столкнулись
--     с номерами RetailCRM и было видно, чей это заказ;
--   * свой журнал оплат: платёж по нашему заказу нельзя провести в RetailCRM,
--     его просто негде отразить.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS is_own BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_is_own ON public.orders (is_own) WHERE is_own;

COMMENT ON COLUMN public.orders.is_own IS
  'Заказ заведён у нас и в RetailCRM не отправляется. Сверка удалённых его не трогает';

-- Кто из менеджеров работает в нашей базе.
ALTER TABLE public.managers
    ADD COLUMN IF NOT EXISTS own_crm BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.managers.own_crm IS
  'Менеджер ведёт заказы в нашей CRM: его заказы создаются здесь, не в RetailCRM';

-- Счётчик номеров. Номера RetailCRM — числа, наши отличаются буквой «А».
CREATE SEQUENCE IF NOT EXISTS public.own_order_number_seq START 1;

COMMENT ON SEQUENCE public.own_order_number_seq IS
  'Счётчик номеров своих заказов: номер выглядит как 1001А';

-- Журнал оплат по своим заказам.
CREATE TABLE IF NOT EXISTS public.own_order_payments (
    id           BIGSERIAL PRIMARY KEY,
    order_id     BIGINT NOT NULL,
    order_number TEXT NOT NULL,
    /** Сумма в рублях. Копейки хранить не нужно: счета выставляем в рублях. */
    amount       NUMERIC NOT NULL,
    paid_at      DATE NOT NULL,
    /** Чем платили: банковский перевод, наличные, карта. */
    method       TEXT,
    payer_name   TEXT,
    purpose      TEXT,
    /** Связь с поступлением из банка, если платёж пришёл оттуда. */
    point_payment_id BIGINT,
    created_by   TEXT,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_own_order_payments_order ON public.own_order_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_own_order_payments_date ON public.own_order_payments (paid_at DESC);

ALTER TABLE public.own_order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.own_order_payments;
CREATE POLICY "service role full access" ON public.own_order_payments FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.own_order_payments IS
  'Оплаты по своим заказам: в RetailCRM их отразить негде';

-- Счётчик через REST мы дёргать не можем — нужна функция.
CREATE OR REPLACE FUNCTION public.nextval_own_order_number()
RETURNS BIGINT
LANGUAGE sql
AS $$ SELECT nextval('public.own_order_number_seq') $$;
