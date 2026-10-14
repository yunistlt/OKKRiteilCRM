-- Вложения писем хранятся у нас, а не только в ящике.
--
-- Андрей 14.10.2026: «надо значит хранить и вложения». До сих пор в
-- `attachments_meta` лежала только опись (имя, тип, размер), а сам файл жил в
-- ящике rop@zmktlt.ru: почистили ящик — вложение потеряно, и в поиске по
-- файлам его нет.
--
-- Сами файлы уезжают в бакет `okk-assets` (туда же, куда ручные вложения
-- заказа), путь дописывается в ту же опись полем `storagePath` — отдельной
-- таблицы не заводим.
--
-- Нужна одна отметка: у какого письма файлы уже забраны. Без неё проход каждый
-- раз перечитывал бы весь ящик.
--
-- Проверено перед правкой (закон «проверь, что такого ещё нет»): колонки
-- attachments_stored_at в incoming_emails нет.

ALTER TABLE public.incoming_emails
    ADD COLUMN IF NOT EXISTS attachments_stored_at timestamptz;

COMMENT ON COLUMN public.incoming_emails.attachments_stored_at IS
    'Когда вложения письма забраны из ящика в хранилище. NULL — ещё не забраны';

-- Проход ищет только письма с вложениями, у которых отметки нет.
CREATE INDEX IF NOT EXISTS incoming_emails_attachments_pending_idx
    ON public.incoming_emails (received_at DESC)
    WHERE has_attachments AND attachments_stored_at IS NULL;
