-- ============================================================
-- Добавление полей получателя (контактного лица) в историю рассылки
-- ============================================================

ALTER TABLE ai_outreach_logs 
ADD COLUMN IF NOT EXISTS contact_id BIGINT,
ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- Обновление индекса для быстрого поиска по контактам (опционально)
CREATE INDEX IF NOT EXISTS idx_ai_outreach_logs_contact_id ON ai_outreach_logs(contact_id);
