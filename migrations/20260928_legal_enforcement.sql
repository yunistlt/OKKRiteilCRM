-- Исполнительные производства (ФССП) в юридическом отделе.
-- Человек создаёт карточку и грузит документы, бот разбирает и заполняет ЧЕРНОВИК,
-- человек подтверждает спорное. Аддитивно, ничего существующего не меняем.

-- 1. Карточка производства ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_enforcement_cases (
    id                  bigserial PRIMARY KEY,
    -- Минимум от человека
    debtor_inn          text,                 -- ИНН должника (юрлицо группы)
    debtor_name         text,                 -- название должника
    project             text,                 -- 'zmktl' | 'stolyarka' | 'consulting' | NULL (как в point_payments)
    -- Заполняет бот, подтверждает человек
    case_number         text,                 -- номер исполнительного производства
    started_on          date,                 -- дата возбуждения
    claimant_name       text,                 -- взыскатель
    claimant_inn        text,
    debt_amount_kopecks bigint,               -- сумма долга
    charge_amount_kopecks bigint,             -- сумма взыскания (исполн. сбор и пр.)
    fssp_department     text,                 -- отдел ФССП
    bailiff_name        text,                 -- пристав
    ground              text,                 -- основание: tax|court|counterparty|fine|employee|fund|other
    court_case_number   text,                 -- номер дела суда
    writ_number         text,                 -- исполнительный лист / судебный приказ
    debt_period_from    date,
    debt_period_to      date,
    management_account  text,                 -- управленческая статья (предлагает бот)
    -- Жизненный цикл карточки
    status              text NOT NULL DEFAULT 'docs_uploaded',
    -- docs_uploaded | parsed | needs_review | confirmed | payments_linked | in_fd_report | closed
    closed_on           date,
    closed_reason       text,
    note                text,
    parse_status        text NOT NULL DEFAULT 'idle',   -- idle|queued|processing|completed|failed
    parse_error         text,
    parsed_at           timestamptz,
    created_by          text,
    confirmed_by        text,
    confirmed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_enf_case_number
    ON public.legal_enforcement_cases (case_number) WHERE case_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legal_enf_status ON public.legal_enforcement_cases (status);
CREATE INDEX IF NOT EXISTS idx_legal_enf_debtor_inn ON public.legal_enforcement_cases (debtor_inn);
CREATE INDEX IF NOT EXISTS idx_legal_enf_parse_status ON public.legal_enforcement_cases (parse_status);

-- 2. Документы карточки (файл + сырой OCR-текст) ---------------------------
CREATE TABLE IF NOT EXISTS public.legal_enforcement_documents (
    id              bigserial PRIMARY KEY,
    case_id         bigint NOT NULL REFERENCES public.legal_enforcement_cases (id) ON DELETE CASCADE,
    title           text,
    file_name       text NOT NULL,
    storage_bucket  text NOT NULL DEFAULT 'legal-enforcement',
    storage_path    text NOT NULL,
    content_type    text,
    file_size_bytes bigint,
    upload_status   text NOT NULL DEFAULT 'pending_upload', -- pending_upload|uploaded|failed
    scan_status     text NOT NULL DEFAULT 'pending',        -- pending|clean|infected|error
    doc_kind        text,        -- postanovlenie|trebovanie|reshenie|prikaz|list|inkasso|other (определяет бот)
    extract_status  text NOT NULL DEFAULT 'queued',         -- queued|completed|manual_review_required|failed
    extract_warnings jsonb,
    raw_text        text,        -- СЫРОЙ текст OCR — храним всегда, иначе вывод не доказать
    uploaded_by     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_enf_doc_case ON public.legal_enforcement_documents (case_id);

-- 3. Доказательство под каждым полем --------------------------------------
-- Одна строка = «поле X = значение Y, потому что в документе D написано Z».
CREATE TABLE IF NOT EXISTS public.legal_enforcement_field_facts (
    id            bigserial PRIMARY KEY,
    case_id       bigint NOT NULL REFERENCES public.legal_enforcement_cases (id) ON DELETE CASCADE,
    document_id   bigint REFERENCES public.legal_enforcement_documents (id) ON DELETE SET NULL,
    field         text NOT NULL,        -- имя колонки карточки: case_number, claimant_name, ...
    value_text    text,                 -- значение в человеческом виде (то, что показываем)
    value_raw     jsonb,                -- нормализованное значение (число/дата/код)
    quote         text,                 -- фрагмент документа-доказательство
    confidence    numeric(4, 3),        -- 0..1 от извлекателя
    extractor     text NOT NULL DEFAULT 'regex',  -- regex|ai|human
    conflicts_with text,                -- чем конфликтует (другой документ, платёж)
    state         text NOT NULL DEFAULT 'suggested', -- suggested|confirmed|rejected|superseded
    confirmed_by  text,
    confirmed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_enf_fact_case ON public.legal_enforcement_field_facts (case_id, field);
CREATE INDEX IF NOT EXISTS idx_legal_enf_fact_state ON public.legal_enforcement_field_facts (state);

-- 4. Связь производства с банковскими платежами ----------------------------
CREATE TABLE IF NOT EXISTS public.legal_enforcement_payment_links (
    id            bigserial PRIMARY KEY,
    case_id       bigint NOT NULL REFERENCES public.legal_enforcement_cases (id) ON DELETE CASCADE,
    payment_id    bigint NOT NULL REFERENCES public.point_payments (id) ON DELETE CASCADE,
    link_state    text NOT NULL DEFAULT 'suggested', -- suggested|confirmed|rejected
    match_reason  jsonb,          -- по каким признакам предложено (номер ИП, лист, сумма, дата, ИНН, назначение)
    confidence    numeric(4, 3),
    confirmed_by  text,
    confirmed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_enf_payment_link
    ON public.legal_enforcement_payment_links (case_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_legal_enf_payment_link_payment
    ON public.legal_enforcement_payment_links (payment_id);
