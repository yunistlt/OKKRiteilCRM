-- Координаты отправленного уведомления об оплате в Telegram.
-- Нужны, чтобы при переносе платежа в другой проект бот мог удалить своё старое
-- сообщение в прежнем чате, а не только отправить новое в правильный.
-- Аддитивно: у исторических строк NULL — такие сообщения удаляются руками.
ALTER TABLE point_payments
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_message_id bigint;
