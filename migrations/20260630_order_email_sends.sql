-- Реестр исходящих писем по заказу (идемпотентность отправки писем об актуальности
-- и любой переписки по заказу). Заполняется после успешной отправки через sendOrderEmail.
-- Аддитивно: новая таблица, ничего не ломает.

CREATE TABLE IF NOT EXISTS order_email_sends (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number     text NOT NULL,
    order_id         bigint,
    to_email         text NOT NULL,
    subject          text NOT NULL,
    message_id       text,
    appended_to_sent boolean NOT NULL DEFAULT false,
    sent_by          text,            -- кто инициировал отправку (email/роль из сессии)
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_email_sends_order_number ON order_email_sends (order_number);
CREATE INDEX IF NOT EXISTS idx_order_email_sends_created_at ON order_email_sends (created_at DESC);
