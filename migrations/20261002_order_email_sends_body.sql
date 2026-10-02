-- Текст исходящего письма сохраняем в момент отправки.
--
-- Было: запись об отправке хранила только факт (кому, тема, message_id), а текст
-- доставался из папки «Отправленные» — её притягивает IMAP-синк с задержкой.
-- Пока синк не дошёл, менеджер видел в ленте «Текст этого письма у нас не сохранён».
--
-- Аддитивно: две колонки с NULL по умолчанию, старые записи не трогаем.

ALTER TABLE public.order_email_sends
    ADD COLUMN IF NOT EXISTS body_html text,
    ADD COLUMN IF NOT EXISTS body_text text;

COMMENT ON COLUMN public.order_email_sends.body_html IS 'Тело письма как отправили (HTML)';
COMMENT ON COLUMN public.order_email_sends.body_text IS 'Тело письма простым текстом — для ленты переписки по заказу';
