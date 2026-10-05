-- HTML-часть письма из папки «Отправленные».
--
-- Синк Sent сохранял только текстовую часть, а письма уходили одним HTML — текста
-- не было вовсе, и лента переписки по заказу писала «текст не сохранён».
-- Парсер письма HTML уже отдаёт (`lib/email/imap.ts`), осталось его сохранить.
--
-- Аддитивно: одна колонка с NULL по умолчанию.

ALTER TABLE public.outgoing_emails
    ADD COLUMN IF NOT EXISTS body_html text;

COMMENT ON COLUMN public.outgoing_emails.body_html IS 'HTML-часть письма: часть писем уходит без текстовой части';
