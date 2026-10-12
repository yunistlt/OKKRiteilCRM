-- Черновик письма помнит вложения, а не их имена.
--
-- Раньше в черновике лежал только список названий, и при возврате человек
-- видел «вложения нужно приложить заново». Файл, приложенный один раз,
-- отваливаться не должен (решение владельца 12.10.2026).
--
-- Храним номера файлов заказа: сами файлы уже лежат у нас, второй копии не
-- заводим.

ALTER TABLE public.order_email_drafts
    ADD COLUMN IF NOT EXISTS order_file_ids BIGINT[],
    ADD COLUMN IF NOT EXISTS documents TEXT[];

COMMENT ON COLUMN public.order_email_drafts.order_file_ids IS
    'Файлы заказа, приложенные к черновику: письмо соберёт их заново при отправке.';
COMMENT ON COLUMN public.order_email_drafts.documents IS
    'Какие документы собрать к письму: proposal (КП) и/или invoice (счёт).';
