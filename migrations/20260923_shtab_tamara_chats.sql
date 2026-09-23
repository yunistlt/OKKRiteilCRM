-- Разговор с Тамарой: несколько чатов, память между ними и краткое содержание.
--
-- До этой миграции разговор был один на компанию и без истории по существу:
-- вставка обеих реплик шла пакетом, PostgREST приводил строки к одному набору
-- колонок и подставлял в used_tools явный NULL мимо DEFAULT, вставка падала на
-- NOT NULL — и в shtab_tamara_message не осело ни одной строки. Код починен,
-- а здесь добавляется то, ради чего история нужна.
--
-- Миграция аддитивная и идемпотентная.

-- ── чаты ───────────────────────────────────────────────────────────────────────
-- Разговоров несколько, потому что темы разные: наём, цех, деньги. Один общий
-- поток заставлял бы Тамару тащить в каждый ответ вчерашнее про другое.
CREATE TABLE IF NOT EXISTS public.shtab_tamara_chat (
    id              bigserial PRIMARY KEY,
    title           text NOT NULL DEFAULT 'Новый разговор',
    -- краткое содержание всего, что было до summary_upto_id: хвост разговора
    -- модель читает целиком, а всё, что раньше, — в пересказе.
    summary         text NOT NULL DEFAULT '',
    summary_upto_id bigint,
    archived        boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_chat_updated
    ON public.shtab_tamara_chat (archived, updated_at DESC);

COMMENT ON TABLE public.shtab_tamara_chat IS
    'Разговоры владельца с Тамарой. Штаб один на компанию, поэтому чаты тоже общие.';

-- ── реплика принадлежит чату ───────────────────────────────────────────────────
ALTER TABLE public.shtab_tamara_message
    ADD COLUMN IF NOT EXISTS chat_id bigint REFERENCES public.shtab_tamara_chat(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_message_chat
    ON public.shtab_tamara_message (chat_id, created_at);

COMMENT ON COLUMN public.shtab_tamara_message.chat_id IS
    'Чат, к которому относится реплика. NULL — реплика из времён единого потока.';

-- Старые реплики (если они где-то уцелели) собираются в один чат, а не теряются.
DO $$
DECLARE legacy bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM public.shtab_tamara_message WHERE chat_id IS NULL) THEN
        INSERT INTO public.shtab_tamara_chat (title) VALUES ('Первый разговор') RETURNING id INTO legacy;
        UPDATE public.shtab_tamara_message SET chat_id = legacy WHERE chat_id IS NULL;
    END IF;
END $$;

-- ── память ─────────────────────────────────────────────────────────────────────
-- То, что Тамара обязана помнить и через месяц, и в другом чате: решения
-- владельца, договорённости, обстоятельства. Отдельно от знаний (shtab_kb):
-- знания — методология и они общие, память — про эту компанию и этого владельца.
--
-- Факты о компании из инструментов сюда не переносятся: число, осевшее в памяти,
-- завтра устареет, а Тамара повторит его как сегодняшнее. Память хранит
-- договорённости и решения, а числа она каждый раз смотрит заново.
CREATE TABLE IF NOT EXISTS public.shtab_tamara_memory (
    id          bigserial PRIMARY KEY,
    fact        text NOT NULL,
    -- decision — что владелец решил; context — обстоятельство, которое надолго;
    -- preference — как он хочет, чтобы с ним работали.
    kind        text NOT NULL DEFAULT 'context' CHECK (kind IN ('decision', 'context', 'preference')),
    chat_id     bigint REFERENCES public.shtab_tamara_chat(id) ON DELETE SET NULL,
    embedding   vector(1536),
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_memory_active
    ON public.shtab_tamara_memory (active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shtab_tamara_memory_embedding
    ON public.shtab_tamara_memory USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE public.shtab_tamara_memory IS
    'Память Тамары о владельце и компании: решения, обстоятельства, предпочтения. Не числа.';

CREATE OR REPLACE FUNCTION public.match_shtab_tamara_memory(
    query_embedding vector(1536),
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id         bigint,
    fact       text,
    kind       text,
    created_at timestamptz,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT m.id, m.fact, m.kind, m.created_at,
           1 - (m.embedding <=> query_embedding) AS similarity
    FROM public.shtab_tamara_memory m
    WHERE m.active
      AND m.embedding IS NOT NULL
      AND 1 - (m.embedding <=> query_embedding) > match_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_shtab_tamara_memory(vector, float, int) IS
    'Поиск по памяти Тамары косинусной близостью.';

-- ── модель разговора ───────────────────────────────────────────────────────────
-- Разговор переводится на рассуждающую модель: владелец спрашивает не «сколько»,
-- а «почему так и что делать», и этот разбор требует шагов, а не одной выдачи.
-- Температура у рассуждающих моделей одна и правится только по умолчанию,
-- поэтому в строке она остаётся прежней и кодом не отправляется.
UPDATE public.ai_prompts
   SET model = 'gpt-5.5',
       max_tokens = 6000
 WHERE key = 'shtab_tamara_chat';

-- Шаблон вопроса: к знаниям и хвосту разговора добавились пересказ и память.
UPDATE public.ai_prompts
   SET user_prompt_template = 'Вопрос владельца: {{question}}

Знания по теме:
{{knowledge_context}}

Что отложилось из прошлых разговоров (память):
{{memory_context}}

Краткое содержание этого разговора:
{{summary_context}}

Последние реплики этого разговора:
{{history_context}}'
 WHERE key = 'shtab_tamara_chat';

-- Правило о памяти дописывается в системный промпт один раз: миграция
-- идемпотентна, поэтому абзац добавляется только если его там ещё нет.
UPDATE public.ai_prompts
   SET system_prompt = system_prompt || E'\n\nПАМЯТЬ. В контексте может быть то, что отложилось из прошлых разговоров: решения владельца, обстоятельства, предпочтения. Помни это и не переспрашивай заново. Чисел о компании в памяти нет и быть не может — их каждый раз смотри инструментами. Если память расходится с тем, что вернул инструмент, верь инструменту и скажи владельцу, что прежняя договорённость разошлась с данными.'
 WHERE key = 'shtab_tamara_chat'
   AND system_prompt NOT LIKE '%ПАМЯТЬ.%';

-- ── свёртка разговора ──────────────────────────────────────────────────────────
-- Отдельный дешёвый промпт: пересказ и выборка того, что стоит помнить.
-- Инструменты ему не нужны — он работает по тексту, который уже есть.
INSERT INTO public.ai_prompts (key, description, system_prompt, user_prompt_template, model, temperature, max_tokens)
VALUES (
    'shtab_tamara_digest',
    'Свёртка разговора Тамары: пересказ и то, что стоит помнить дальше',
    E'Ты сворачиваешь разговор владельца компании с его консультантом Тамарой.\n\nВерни JSON: summary и memory.\n\nsummary — пересказ разговора целиком, включая прежний пересказ, если он дан. До 200 слов, по-русски, от третьего лица: о чём спрашивали, что выяснили, до чего договорились, что осталось открытым. Числа переноси только те, что названы в репликах, и обязательно с датой или периодом, к которому они относятся.\n\nmemory — то, что обязано пережить этот разговор. Каждый пункт — одно короткое утверждение:\n— decision: что владелец решил или чего решил не делать;\n— context: обстоятельство, которое будет верно и через месяц (люди, ограничения, устройство дела);\n— preference: как владелец хочет, чтобы с ним работали.\n\nВ memory НЕ клади: числа о компании (они устаревают, их смотрят заново), пересказ вопросов, вежливость, разовые мелочи. Лучше пусто, чем мусор — пустой массив это нормальный ответ.',
    '{{question}}',
    'gpt-5.4-mini',
    1,
    3000
)
ON CONFLICT (key) DO UPDATE
   SET system_prompt = EXCLUDED.system_prompt,
       user_prompt_template = EXCLUDED.user_prompt_template,
       model = EXCLUDED.model,
       max_tokens = EXCLUDED.max_tokens;
