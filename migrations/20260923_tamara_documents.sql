-- Документы, которые делает Тамара.
--
-- На просьбу «сделай это красивым PDF» она отвечала, что файлов делать не умеет,
-- и предлагала скопировать текст в Word. Теперь делает.
--
-- Хранится не файл, а его содержание: разметка, из которой PDF собирается в
-- момент скачивания. Так документ всегда свежей вёрстки, не нужно хранилище и
-- нечего чистить; а главное — содержание остаётся читаемым и правится, чего о
-- готовом PDF не скажешь.

CREATE TABLE IF NOT EXISTS public.shtab_tamara_doc (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    subtitle    TEXT,
    -- Тело в той же разметке, которой она отвечает в разговоре.
    body        TEXT NOT NULL,
    -- Из какого разговора документ — чтобы вернуться к обсуждению.
    chat_id     BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Сколько раз скачивали: документ, который никто не открыл, — повод
    -- спросить, нужен ли он вообще.
    opened      INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tamara_doc_chat
    ON public.shtab_tamara_doc (chat_id, created_at DESC);

ALTER TABLE public.shtab_tamara_doc ENABLE ROW LEVEL SECURITY;
