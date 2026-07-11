-- Отметка об отправке уведомления об оплате в Telegram — чтобы слать один раз на платёж.
ALTER TABLE public.point_payments
    ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Все существующие платежи помечаем как уже уведомлённые, чтобы после включения
-- уведомлений не спамить чат историей — шлём только на новые поступления.
UPDATE public.point_payments
   SET notified_at = COALESCE(notified_at, updated_at, now())
 WHERE notified_at IS NULL;
