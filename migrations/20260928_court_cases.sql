-- Арбитражные дела наших юрлиц. Источник — письма «Электронного стража»
-- (kad.arbitr.ru сам присылает уведомления на подписанный ящик).
-- Картотеку мы не опрашиваем: её защита не пускает автоматические запросы.

CREATE TABLE IF NOT EXISTS public.court_cases (
    id              bigserial PRIMARY KEY,
    case_number     text NOT NULL,              -- А55-12345/2026
    kad_url         text,                       -- ссылка на карточку дела
    court_name      text,
    case_type       text,                       -- административное|гражданское|банкротное|иное
    our_inn         text,                       -- ИНН нашего юрлица, по которому дело нашлось
    our_role        text,                       -- истец|ответчик|иное|не определено
    plaintiff       text,
    defendant       text,
    amount_kopecks  bigint,                     -- цена иска, если названа
    registered_on   date,
    last_event_on   date,
    last_event      text,
    status          text NOT NULL DEFAULT 'active',  -- active|closed
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_court_cases_number ON public.court_cases (case_number);
CREATE INDEX IF NOT EXISTS idx_court_cases_our_inn ON public.court_cases (our_inn);
CREATE INDEX IF NOT EXISTS idx_court_cases_last_event ON public.court_cases (last_event_on DESC);

-- Движение по делу: одно письмо стража = одна строка.
CREATE TABLE IF NOT EXISTS public.court_case_events (
    id            bigserial PRIMARY KEY,
    case_id       bigint NOT NULL REFERENCES public.court_cases (id) ON DELETE CASCADE,
    event_on      date,
    event_text    text NOT NULL,
    doc_url       text,
    source        text NOT NULL DEFAULT 'straj_email',
    email_id      bigint,                       -- строка incoming_emails, откуда взято
    raw_excerpt   text,                         -- фрагмент письма: доказательство вывода
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_court_case_events_case ON public.court_case_events (case_id, event_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_court_case_event_email
    ON public.court_case_events (case_id, email_id, event_text) WHERE email_id IS NOT NULL;
