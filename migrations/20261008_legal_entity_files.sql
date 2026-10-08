-- ============================================================================
-- Документы нашего юрлица: устав, ЕГРЮЛ, ИНН, карточка предприятия.
--
-- До сих пор менеджеры слали клиенту ссылку на Яндекс.Диск («Ссылка для
-- скачивания уставных документов ООО ЗМК: disk.yandex.ru/d/…»). Чужое
-- хранилище: ссылка может протухнуть, доступ не наш, что там лежит и какой
-- давности — не видно. Владелец 08.10.2026: держать документы у себя и давать
-- ссылку со своего сайта.
--
-- Файлы кладём в тот же бакет `okk-assets`, что и печать с подписью юрлица.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legal_entity_files (
    id            BIGSERIAL PRIMARY KEY,
    entity_id     BIGINT      NOT NULL REFERENCES public.legal_entities(id) ON DELETE CASCADE,
    -- Человеческое имя файла: его увидит клиент в списке.
    file_name     TEXT        NOT NULL,
    content_type  TEXT,
    size_bytes    BIGINT,
    storage_path  TEXT        NOT NULL,
    -- Папка на Диске, из которой приехал файл: «Устав», «Карточка с реквизитами».
    -- Пусто — файл лежит в корне.
    folder        TEXT,
    /**
     * Виден ли файл по публичной ссылке. По умолчанию да: эти документы и так
     * рассылались клиентам. Налоговые декларации и договор аренды можно
     * закрыть — решает человек в карточке юрлица.
     */
    is_public     BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order    INT         NOT NULL DEFAULT 100,
    -- Откуда взяли: ссылка на Яндекс.Диск или «загружен вручную».
    source        TEXT,
    uploaded_by   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (entity_id, storage_path)
);

CREATE INDEX IF NOT EXISTS legal_entity_files_entity_idx
    ON public.legal_entity_files (entity_id) WHERE deleted_at IS NULL;

/**
 * Короткий код юрлица для публичной ссылки: /docs/zmk вместо /docs/6324017492.
 * ИНН в адресе письма клиенту выглядит как утечка лишнего, да и запомнить его
 * нельзя. Код задаёт человек в карточке юрлица.
 */
ALTER TABLE public.legal_entities
    ADD COLUMN IF NOT EXISTS public_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS legal_entities_public_slug_idx
    ON public.legal_entities (public_slug) WHERE public_slug IS NOT NULL;
