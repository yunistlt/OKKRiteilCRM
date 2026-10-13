-- ============================================================================
-- Шлюз чтения: документ, который нужно прочитать до начала работы.
--
-- Первый потребитель — утренний разбор вчерашнего дня, но механизм общий:
-- тем же способом закрывается изменённый регламент, новый норматив, приказ.
-- Поэтому в таблице не «разбор», а пара «вид документа + ссылка на документ».
--
-- Состояние только здесь, в базе: в localStorage его держать нельзя — оно
-- обходится очисткой данных браузера, не переезжает на другое устройство и не
-- видно руководителю.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_read_gate (
    id bigserial PRIMARY KEY,
    doc_kind text NOT NULL,
    doc_ref text NOT NULL,
    user_id uuid NOT NULL,
    -- Сколько секунд требовалось НА МОМЕНТ ПОКАЗА: порог могут поменять позже,
    -- и человек не должен внезапно оказаться «недочитавшим».
    required_seconds int NOT NULL,
    opened_at timestamptz,
    -- Накопленное время с ОТКРЫТОЙ вкладкой. Копится порциями, прирост сверяет
    -- сервер: одним числом в конце его подделали бы из консоли.
    visible_seconds int NOT NULL DEFAULT 0,
    scrolled_to_end boolean NOT NULL DEFAULT false,
    confirmed_at timestamptz,
    deferred_at timestamptz,
    defer_reason text,
    defer_until timestamptz,
    -- Время последней порции: по нему сервер считает, сколько реально прошло.
    last_beat_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (doc_kind, doc_ref, user_id)
);

COMMENT ON TABLE public.document_read_gate IS
    'Шлюз чтения: кто какой документ открыл, сколько читал и подтвердил ли прочтение. Один ряд на пару «документ + человек».';

-- Экран руководителя смотрит «кто что прочитал за дату».
CREATE INDEX IF NOT EXISTS document_read_gate_kind_created_idx
    ON public.document_read_gate (doc_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS document_read_gate_user_idx
    ON public.document_read_gate (user_id, created_at DESC);
