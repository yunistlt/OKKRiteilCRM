-- Претензионно-исковая работа: один конфликт = одно дело с постоянным ID.
-- Претензия, переговоры, суд, исполнительное производство — стадии ОДНОГО дела,
-- а не отдельные реестры. Существующие court_cases и legal_enforcement_cases
-- не меняем: подключаем их к делу через таблицу связей.
-- Аддитивно: только новые таблицы.

-- 1. Юрлица нашей группы ---------------------------------------------------
-- Раньше принадлежность хранилась строкой project ('zmktl'), справочника не было.
CREATE TABLE IF NOT EXISTS public.legal_entities (
    id          bigserial PRIMARY KEY,
    inn         text NOT NULL,
    short_name  text NOT NULL,        -- как показываем человеку
    full_name   text,
    kind        text NOT NULL DEFAULT 'ooo',  -- ooo|ip|other
    active      boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL DEFAULT 100,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_entities_inn ON public.legal_entities (inn);

-- ИНН известны только для двух — остальные дозаполняются в интерфейсе.
INSERT INTO public.legal_entities (inn, short_name, kind, sort_order)
VALUES ('6324017492', 'ООО ЗМК', 'ooo', 10),
       ('6321277326', 'ООО ПОБТ', 'ooo', 20)
ON CONFLICT (inn) DO NOTHING;

-- 2. Справочники раздела ---------------------------------------------------
-- Русские названия только здесь: в коде ходят коды, на экране — name.
CREATE TABLE IF NOT EXISTS public.legal_matter_dictionaries (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,   -- category|stage|status|event_kind|matter_side|outcome|risk_level|close_reason
    code        text NOT NULL,
    name        text NOT NULL,   -- человеческое название для интерфейса
    description text,
    color       text,
    sort_order  integer NOT NULL DEFAULT 100,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_matter_dict ON public.legal_matter_dictionaries (kind, code);
CREATE INDEX IF NOT EXISTS idx_legal_matter_dict_kind ON public.legal_matter_dictionaries (kind, sort_order);

-- 3. Дело (спор) -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_matters (
    id                      bigserial PRIMARY KEY,
    matter_no               text NOT NULL,        -- 2026-047, не меняется никогда
    -- Стороны
    our_entity_inn          text,                 -- наше юрлицо (legal_entities.inn)
    counterparty_name       text,
    counterparty_inn        text,
    counterparty_rep        text,                 -- представитель контрагента (нужнее судьи на переговорах)
    matter_side             text NOT NULL DEFAULT 'respondent', -- claimant (мы требуем) | respondent (требуют с нас)
    -- Суть
    category                text,                 -- postavka|podryad|arenda|debitorka|trudovoj|... (справочник)
    subject                 text,                 -- 1-2 предложения, а не юридический текст
    our_position            text,
    cause                   text,                 -- брак|просрочка|неоплата|...
    contract_no             text,
    contract_date           date,
    order_number            text,                 -- заказ в CRM, чтобы не вводить контрагента дважды
    business_unit           text,                 -- продажи|производство|бухгалтерия|HR
    -- Ответственные
    responsible_user_id     text,                 -- юрист (users.id)
    business_owner          text,                 -- ответственный от бизнеса
    -- Жизненный цикл
    stage                   text NOT NULL DEFAULT 'claim',  -- claim|talks|lawsuit|court|appeal|enforcement|closed
    status                  text NOT NULL DEFAULT 'new',    -- new|in_work|waiting_counterparty|court|enforcement|paused|closed
    risk_level              text,                 -- low|medium|high, только если методика утверждена
    opened_on               date NOT NULL DEFAULT CURRENT_DATE,
    closed_on               date,
    close_reason            text,
    outcome                 text,
    -- Следующее действие — движок раздела, у активного дела пустым быть не может
    next_action             text,
    next_action_due         date,
    -- Исковая давность: пропуск = потеря денег безвозвратно
    claim_right_on          date,                 -- когда возникло право требования
    limitation_until        date,                 -- когда истекает срок ИД
    -- Деньги, всё в копейках
    contract_amount_kopecks         bigint,       -- цена договора
    claim_amount_kopecks            bigint,       -- сумма требований контрагента
    our_claim_amount_kopecks        bigint,       -- наша сумма требования
    penalty_kopecks                 bigint,       -- неустойка
    damages_kopecks                 bigint,       -- убытки
    state_duty_kopecks              bigint,       -- госпошлина (платится вперёд, возвращается отдельно)
    court_costs_kopecks             bigint,       -- судебные расходы
    settled_amount_kopecks          bigint,       -- урегулировано добровольно
    recovered_kopecks               bigint,       -- фактически взыскано
    paid_out_kopecks                bigint,       -- фактически выплачено нами
    costs_recovered_kopecks         bigint,       -- судебные расходы взысканы
    -- Досудебный этап
    claim_received_on       date,                 -- претензия получена
    claim_reply_due         date,                 -- срок ответа
    claim_replied_on        date,                 -- ответ направлен
    claim_result            text,                 -- otklonena|udovletvorena|chastichno|peregovory
    note                    text,
    created_by              text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_matters_no ON public.legal_matters (matter_no);
CREATE INDEX IF NOT EXISTS idx_legal_matters_stage ON public.legal_matters (stage);
CREATE INDEX IF NOT EXISTS idx_legal_matters_status ON public.legal_matters (status);
CREATE INDEX IF NOT EXISTS idx_legal_matters_due ON public.legal_matters (next_action_due) WHERE closed_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matters_limitation ON public.legal_matters (limitation_until) WHERE closed_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matters_counterparty ON public.legal_matters (counterparty_inn);
CREATE INDEX IF NOT EXISTS idx_legal_matters_responsible ON public.legal_matters (responsible_user_id);

-- 4. Журнал дела -----------------------------------------------------------
-- «Последнее действие» НЕ хранится в деле: оно вычисляется отсюда,
-- иначе реестр разъезжается с историей.
CREATE TABLE IF NOT EXISTS public.legal_matter_events (
    id            bigserial PRIMARY KEY,
    matter_id     bigint NOT NULL REFERENCES public.legal_matters (id) ON DELETE CASCADE,
    event_on      date NOT NULL DEFAULT CURRENT_DATE,
    kind          text NOT NULL DEFAULT 'action',  -- claim_in|claim_out|reply|talks|filing|hearing|ruling|writ|payment|stage_change|note
    title         text NOT NULL,
    description   text,
    result        text,
    document_id   bigint,          -- legal_matter_documents.id, ссылку ставим ниже
    stage_before  text,
    stage_after   text,
    actor         text,            -- кто сделал
    source        text NOT NULL DEFAULT 'human',   -- human|bot|import
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_events_matter ON public.legal_matter_events (matter_id, event_on DESC, id DESC);

-- 5. Стадии как связи с существующими сущностями ---------------------------
-- Суд и исполнительное производство остаются в своих таблицах; дело знает о них отсюда.
CREATE TABLE IF NOT EXISTS public.legal_matter_links (
    id            bigserial PRIMARY KEY,
    matter_id     bigint NOT NULL REFERENCES public.legal_matters (id) ON DELETE CASCADE,
    target_kind   text NOT NULL,   -- court_case|enforcement_case|order|payment
    target_id     text NOT NULL,   -- id целевой записи в её таблице (text — ключи разного типа)
    role          text,            -- first_instance|appeal|cassation|main|related
    link_state    text NOT NULL DEFAULT 'confirmed', -- suggested|confirmed|rejected
    match_reason  jsonb,
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_matter_link ON public.legal_matter_links (matter_id, target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_legal_matter_link_target ON public.legal_matter_links (target_kind, target_id);

-- 6. Документы дела --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_matter_documents (
    id              bigserial PRIMARY KEY,
    matter_id       bigint NOT NULL REFERENCES public.legal_matters (id) ON DELETE CASCADE,
    title           text,
    file_name       text NOT NULL,
    storage_bucket  text NOT NULL DEFAULT 'legal-matters',
    storage_path    text NOT NULL,
    content_type    text,
    file_size_bytes bigint,
    upload_status   text NOT NULL DEFAULT 'pending_upload', -- pending_upload|uploaded|failed
    scan_status     text NOT NULL DEFAULT 'pending',        -- pending|clean|infected|error
    doc_kind        text,        -- pretenziya|otvet|dogovor|akt|isk|otzyv|reshenie|list|other
    direction       text,        -- in|out
    extract_status  text NOT NULL DEFAULT 'queued',         -- queued|completed|manual_review_required|failed
    extract_warnings jsonb,
    raw_text        text,        -- СЫРОЙ текст — без него вывод не доказать
    uploaded_by     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_doc_matter ON public.legal_matter_documents (matter_id);

ALTER TABLE public.legal_matter_events
    DROP CONSTRAINT IF EXISTS legal_matter_events_document_id_fkey;
ALTER TABLE public.legal_matter_events
    ADD CONSTRAINT legal_matter_events_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.legal_matter_documents (id) ON DELETE SET NULL;

-- 7. Доказательство под каждым полем --------------------------------------
-- «Поле X = значение Y, потому что в документе D написано Z». Пересказ не считается.
CREATE TABLE IF NOT EXISTS public.legal_matter_field_facts (
    id            bigserial PRIMARY KEY,
    matter_id     bigint NOT NULL REFERENCES public.legal_matters (id) ON DELETE CASCADE,
    document_id   bigint REFERENCES public.legal_matter_documents (id) ON DELETE SET NULL,
    field         text NOT NULL,
    value_text    text,
    value_raw     jsonb,
    quote         text,
    confidence    numeric(4, 3),
    extractor     text NOT NULL DEFAULT 'regex',     -- regex|ai|human
    conflicts_with text,
    state         text NOT NULL DEFAULT 'suggested', -- suggested|confirmed|rejected|superseded
    confirmed_by  text,
    confirmed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_fact_matter ON public.legal_matter_field_facts (matter_id, field);
CREATE INDEX IF NOT EXISTS idx_legal_matter_fact_state ON public.legal_matter_field_facts (state);
