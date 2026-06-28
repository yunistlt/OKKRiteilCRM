-- Фича «Автоприём писем» (этап 1: только приём, без AI).
-- ОКК читает общий почтовый ящик (rop@zmktlt.ru) по IMAP в режиме read-only,
-- параллельно с RetailCRM, и складывает входящие письма в свою базу.
-- Мы НЕ опираемся на флаг \Seen (он общий с RetailCRM) — ведём собственный
-- инкрементальный указатель по UID и дедуплим по message_id.

-- 1) Сырые входящие письма.
CREATE TABLE IF NOT EXISTS public.incoming_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- идентификация/дедуп
    message_id TEXT,                       -- заголовок Message-ID (может отсутствовать у кривых писем)
    mailbox TEXT NOT NULL,                 -- ящик-источник, напр. rop@zmktlt.ru
    folder TEXT NOT NULL DEFAULT 'INBOX',  -- IMAP-папка
    imap_uid BIGINT,                       -- UID письма в папке (стабилен в пределах UIDVALIDITY)
    uid_validity BIGINT,                   -- UIDVALIDITY папки на момент чтения

    -- конверт
    from_email TEXT,
    from_name TEXT,
    to_email TEXT,
    subject TEXT,
    in_reply_to TEXT,                      -- для привязки «ответ в ветке» к заказу
    email_refs TEXT,                       -- заголовок References (через пробел)
    received_at TIMESTAMPTZ,               -- дата из письма

    -- тело
    body_text TEXT,
    body_html TEXT,
    has_attachments BOOLEAN NOT NULL DEFAULT false,
    attachments_meta JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{filename,contentType,size}], без бинарей

    -- статус обработки (этапы 2-3 заполнят остальное)
    status TEXT NOT NULL DEFAULT 'new'     -- new|classified|processed|archived|error
        CHECK (status IN ('new', 'classified', 'processed', 'archived', 'error', 'needs_review')),

    -- результаты классификации (этап 2) — заранее, чтобы не плодить миграции
    email_type TEXT,                       -- new_request|complaint|order_question|spam (тех. код)
    confidence DOUBLE PRECISION,
    reasoning TEXT,                        -- объяснение AI на русском
    linked_order_id BIGINT,                -- для рекламаций/вопросов
    created_crm_order_id BIGINT,           -- для новых заявок
    assigned_manager_id BIGINT,
    classified_by TEXT,                    -- 'ai' | 'manual'

    raw JSONB,                             -- доп. служебные поля парсера
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Дедуп по Message-ID в пределах ящика (только когда message_id есть).
CREATE UNIQUE INDEX IF NOT EXISTS incoming_emails_msgid_unique_idx
    ON public.incoming_emails (mailbox, message_id)
    WHERE message_id IS NOT NULL;

-- Запасной дедуп по UID (для писем без Message-ID).
CREATE UNIQUE INDEX IF NOT EXISTS incoming_emails_uid_unique_idx
    ON public.incoming_emails (mailbox, folder, uid_validity, imap_uid)
    WHERE imap_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS incoming_emails_status_idx
    ON public.incoming_emails (status, created_at);
CREATE INDEX IF NOT EXISTS incoming_emails_received_idx
    ON public.incoming_emails (received_at DESC);

-- 2) Указатель инкрементального прогресса по IMAP-папке.
--    Храним последний обработанный UID, чтобы не сканировать 159k писем каждый раз.
CREATE TABLE IF NOT EXISTS public.email_ingest_state (
    mailbox TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    uid_validity BIGINT,                   -- если сервер сменил UIDVALIDITY — указатель сбрасываем
    last_seen_uid BIGINT NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mailbox, folder)
);

-- Доступ только service_role (как у остальных служебных таблиц).
ALTER TABLE public.incoming_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_ingest_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incoming_emails_service_role ON public.incoming_emails;
CREATE POLICY incoming_emails_service_role
    ON public.incoming_emails FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS email_ingest_state_service_role ON public.email_ingest_state;
CREATE POLICY email_ingest_state_service_role
    ON public.email_ingest_state FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
