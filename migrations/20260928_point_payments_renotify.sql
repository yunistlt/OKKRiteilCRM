-- Переотправка уведомления об оплате в правильный чат.
-- Когда у платежа поменяли проект (например, платёж за ПО ошибочно уехал в чат ЗМК),
-- уведомление надо отправить заново — в чат нового проекта. Флаг ставится точечно,
-- воркер point-payment-ingest шлёт и сбрасывает его. Аддитивно, по умолчанию NULL.
ALTER TABLE point_payments
  ADD COLUMN IF NOT EXISTS renotify_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_point_payments_renotify
  ON point_payments (renotify_requested_at)
  WHERE renotify_requested_at IS NOT NULL;
