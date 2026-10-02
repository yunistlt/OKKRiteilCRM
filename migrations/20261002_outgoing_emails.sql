-- Исходящие письма ящика rop@zmktlt.ru: папка «Отправленные».
--
-- Входящие мы читаем давно (incoming_emails), а исходящих у нас не было:
-- письма, которые отправляла сама RetailCRM (уведомления по статусу с тегом
-- «[#магазин/номер]» в теме) и переписка менеджеров через веб-почту в INBOX не
-- попадают. Из-за этого в карточке заказа 49583 семь писем RetailCRM были
-- видны у неё и не видны у нас (замечание владельца 02.10.2026:
-- «письма очень важны»).
--
-- Таблица отдельная, а не incoming_emails: там каждая строка проходит
-- классификацию Катерины и может превратиться в заказ — исходящим это не нужно.

CREATE TABLE IF NOT EXISTS public.outgoing_emails (
    id               BIGSERIAL PRIMARY KEY,
    mailbox          TEXT NOT NULL,
    folder           TEXT NOT NULL,
    imap_uid         BIGINT NOT NULL,
    uid_validity     BIGINT NOT NULL DEFAULT 0,
    message_id       TEXT,
    subject          TEXT,
    from_email       TEXT,
    to_email         TEXT,
    sent_at          TIMESTAMPTZ,
    body_text        TEXT,
    has_attachments  BOOLEAN NOT NULL DEFAULT false,
    attachments_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Номер заказа из тега темы: по нему письмо цепляется к карточке.
    order_number     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Одно письмо = один UID в папке. Повторный заход крона его не дублирует.
CREATE UNIQUE INDEX IF NOT EXISTS outgoing_emails_uid_key
    ON public.outgoing_emails (mailbox, folder, uid_validity, imap_uid);

CREATE INDEX IF NOT EXISTS outgoing_emails_order_idx
    ON public.outgoing_emails (order_number) WHERE order_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS outgoing_emails_sent_idx
    ON public.outgoing_emails (sent_at DESC);

COMMENT ON TABLE public.outgoing_emails IS
  'Исходящие письма ящика (папка «Отправленные»), привязка к заказу по тегу темы [#магазин/номер]';
