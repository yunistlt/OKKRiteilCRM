-- Получатели письма: все адреса «Кому» и «Копия».
--
-- Автоприём сохранял только первый адрес «Кому», а «Копию» не сохранял вовсе.
-- Переписка, где со стороны клиента участвуют снабженец и бухгалтер,
-- выглядела у нас разговором с одним человеком, и кнопку «ответить всем»
-- делать было не из чего.
--
-- Миграция добавочная: старые письма остаются с NULL.

ALTER TABLE public.incoming_emails
    ADD COLUMN IF NOT EXISTS to_emails TEXT[],
    ADD COLUMN IF NOT EXISTS cc_emails TEXT[];

COMMENT ON COLUMN public.incoming_emails.to_emails IS 'Все адреса из «Кому» (to_email — первый из них).';
COMMENT ON COLUMN public.incoming_emails.cc_emails IS 'Адреса из «Копия».';

ALTER TABLE public.order_email_sends
    ADD COLUMN IF NOT EXISTS cc_emails TEXT[],
    ADD COLUMN IF NOT EXISTS bcc_emails TEXT[];

COMMENT ON COLUMN public.order_email_sends.cc_emails IS 'Копия нашего письма: видна получателям.';
COMMENT ON COLUMN public.order_email_sends.bcc_emails IS 'Скрытая копия нашего письма: получателям не видна.';
