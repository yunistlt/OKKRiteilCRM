-- Договоры по заказу: менеджер составляет, юрист согласовывает.
--
-- Проверено перед заведением: таблиц со словами contract/approve/soglas в базе нет
-- (`legal_matter_documents` — документы судебного дела, другая сущность; `document_templates`
-- — печатные формы). Поэтому заводим свои.
--
-- Один договор = одна строка `order_contracts`, каждая правка = строка в
-- `order_contract_versions`: юрист правит текст, и нужно видеть, что именно менялось.
--
-- Аддитивно: новые таблицы, существующее не трогаем.

CREATE TABLE IF NOT EXISTS public.order_contracts (
    id               bigserial PRIMARY KEY,
    -- Номер заказа человеческий («1038А»), как в order_files: он же в теме письма и в документах.
    order_number     text NOT NULL,
    order_id         bigint,
    -- Наше юрлицо-продавец: у ЗМК и ПОБТ разные реквизиты и печати.
    legal_entity_id  bigint REFERENCES public.legal_entities (id),
    kind             text NOT NULL DEFAULT 'postavka',   -- postavka | protokol_raznoglasiy
    title            text NOT NULL,
    -- Что менеджер написал словами: «70 предоплата, 30 перед отгрузкой».
    terms_text       text,
    body_html        text,
    body_text        text,
    -- draft — черновик у менеджера, on_review — у юриста, approved — согласован,
    -- rework — возвращён на доработку.
    status           text NOT NULL DEFAULT 'draft',
    version          integer NOT NULL DEFAULT 1,
    created_by       text,
    submitted_at     timestamptz,
    reviewed_by      text,
    reviewed_at      timestamptz,
    review_comment   text,
    -- Готовый файл: PDF и .docx кладём в okk-assets, как остальные документы заказа.
    pdf_path         text,
    docx_path        text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_order_contracts_order_number
    ON public.order_contracts (order_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_contracts_status
    ON public.order_contracts (status, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.order_contract_versions (
    id             bigserial PRIMARY KEY,
    contract_id    bigint NOT NULL REFERENCES public.order_contracts (id) ON DELETE CASCADE,
    version_number integer NOT NULL,
    body_html      text,
    body_text      text,
    -- Человеческим языком: «составлен», «правка юриста», «согласован», «на доработку».
    change_note    text,
    author         text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_contract_versions_unique
    ON public.order_contract_versions (contract_id, version_number);

COMMENT ON TABLE public.order_contracts IS 'Договоры по заказу: составляет менеджер, согласовывает юрист';
COMMENT ON COLUMN public.order_contracts.terms_text IS 'Условия словами от менеджера — из них ИИ собирает раздел оплаты';
COMMENT ON COLUMN public.order_contracts.status IS 'draft | on_review | approved | rework';
COMMENT ON TABLE public.order_contract_versions IS 'История правок договора: кто, когда и что изменил';
