-- ============================================================================
-- Переписка по заказу: состояние треда и прочитанность письма.
--
-- Сами письма НЕ переносим: входящие живут в `incoming_emails`, исходящие — в
-- `order_email_sends` и `outgoing_emails`. Четвёртая копия дала бы второго
-- писателя и расхождение (закон «проверь, что такого ещё нет»). Тред
-- собирается из писем на лету, а здесь лежит только то, чего нигде нет.
--
-- Постановка: docs/order-mail/TZ.md, §2 и §4.
-- ============================================================================

-- Прочитано ли письмо менеджером В ОКК.
-- Это НЕ флаг \Seen в ящике: его мы не трогаем — на нём держится автоприём
-- Катерины (docs/email-secretary/OVERVIEW.md).
CREATE TABLE IF NOT EXISTS public.order_mail_reads (
    id             BIGSERIAL PRIMARY KEY,
    -- Ключ письма в ленте: «in:<id>» для входящего, «out:<id>» для нашего.
    -- Строкой, потому что письма лежат в разных таблицах с разными ключами.
    message_key    TEXT        NOT NULL,
    order_number   TEXT        NOT NULL,
    -- Кто прочитал: почта или логин из сессии, как в остальных журналах.
    read_by        TEXT        NOT NULL,
    read_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_key, read_by)
);

CREATE INDEX IF NOT EXISTS order_mail_reads_order_idx
    ON public.order_mail_reads (order_number);

-- Состояние треда. Код — для логики, человеческое название — в интерфейсе
-- (закон «только человеческий язык»).
--   awaiting_us     — ждём нас (последнее письмо входящее)
--   awaiting_client — ждём клиента (последнее письмо наше)
--   closed          — закрыт, ставится только руками
-- Первые два вычисляются из писем; в таблице живёт лишь ручное закрытие и
-- владелец, если его меняли.
CREATE TABLE IF NOT EXISTS public.order_mail_threads (
    id            BIGSERIAL PRIMARY KEY,
    order_number  TEXT        NOT NULL,
    -- Ключ треда: идентификатор корневого письма либо нормализованная тема.
    thread_key    TEXT        NOT NULL,
    state         TEXT        NOT NULL DEFAULT 'open'
                  CHECK (state IN ('open', 'closed')),
    closed_by     TEXT,
    closed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_number, thread_key)
);

CREATE INDEX IF NOT EXISTS order_mail_threads_order_idx
    ON public.order_mail_threads (order_number);
