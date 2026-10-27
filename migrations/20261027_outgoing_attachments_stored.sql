-- Отметка, что вложения исходящего письма уже забраны в файлы заказа.
--
-- У входящих такая отметка есть с 14.10.2026 (`incoming_emails.attachments_stored_at`),
-- а наши письма из папки «Отправленные» разбор вложений не трогал вовсе: счета и
-- КП оставались только в ящике. Колонка нужна проходу, чтобы не перечитывать
-- одно и то же письмо каждые десять минут.
ALTER TABLE outgoing_emails
    ADD COLUMN IF NOT EXISTS attachments_stored_at timestamptz;

-- Очередь прохода: письма с вложениями, которые ещё не разобраны.
CREATE INDEX IF NOT EXISTS outgoing_emails_attachments_pending_idx
    ON outgoing_emails (sent_at DESC)
    WHERE has_attachments AND attachments_stored_at IS NULL;
