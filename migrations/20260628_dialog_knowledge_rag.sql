-- РАГ-база знаний бота-продажника из транскрибаций звонков.
-- Единицы знания (ситуация клиента → как отработал менеджер), разложенные по доменам.
-- Граница компетенции бота защищена в ДВУХ местах:
--   1) bot_can_answer — карантин на уровне юнита (спорные домены = false);
--   2) параметр only_bot_answerable в match-функции — бот физически не достаёт спорное при поиске.
-- Стек повторяет okk_consultant_knowledge (pgvector 1536, HNSW, cosine).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.dialog_knowledge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,                 -- dialog:<call_id>:<idx>
    domain text NOT NULL,                      -- продажа|товар|логистика_сроки|рекламация|возврат|суд_претензия|прочее
    type text,                                 -- срок_изготовления|возражение_цена|ассортимент|сигнал_суд|...
    bot_can_answer boolean NOT NULL DEFAULT false,  -- разрешено ли боту отвечать этим знанием
    situation text NOT NULL,                   -- реплика/ситуация клиента (по ней эмбеддинг и поиск)
    response text NOT NULL,                     -- как отработал менеджер (образец для бота / описание для юриста)
    outcome text,                              -- исход/контекст (для корпуса — выигранная сделка)
    source_call_id bigint,                     -- raw_telphin_calls.event_id
    source_order text,                         -- orders.number
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialog_knowledge_domain ON public.dialog_knowledge(domain, bot_can_answer);
CREATE INDEX IF NOT EXISTS idx_dialog_knowledge_active ON public.dialog_knowledge(is_active, bot_can_answer);
CREATE INDEX IF NOT EXISTS idx_dialog_knowledge_call ON public.dialog_knowledge(source_call_id);
CREATE INDEX IF NOT EXISTS idx_dialog_knowledge_embedding ON public.dialog_knowledge USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.dialog_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialog_knowledge_select ON public.dialog_knowledge;
CREATE POLICY dialog_knowledge_select
ON public.dialog_knowledge
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS dialog_knowledge_service_role_write ON public.dialog_knowledge;
CREATE POLICY dialog_knowledge_service_role_write
ON public.dialog_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON public.dialog_knowledge TO authenticated;
GRANT ALL ON public.dialog_knowledge TO postgres, service_role;

-- Векторный поиск. only_bot_answerable=true (по умолчанию) — бот не получит спорные знания.
-- filter_domain — необязательное сужение по конкретному домену.
CREATE OR REPLACE FUNCTION public.match_dialog_knowledge(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    only_bot_answerable boolean DEFAULT true,
    filter_domain text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    slug text,
    domain text,
    type text,
    bot_can_answer boolean,
    situation text,
    response text,
    outcome text,
    source_call_id bigint,
    source_order text,
    tags text[],
    metadata jsonb,
    similarity float
)
LANGUAGE sql
AS $$
    SELECT
        k.id,
        k.slug,
        k.domain,
        k.type,
        k.bot_can_answer,
        k.situation,
        k.response,
        k.outcome,
        k.source_call_id,
        k.source_order,
        k.tags,
        k.metadata,
        1 - (k.embedding <=> query_embedding) AS similarity
    FROM public.dialog_knowledge k
    WHERE k.is_active = true
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> query_embedding) > match_threshold
      AND (only_bot_answerable = false OR k.bot_can_answer = true)
      AND (filter_domain IS NULL OR k.domain = filter_domain)
    ORDER BY similarity DESC
    LIMIT match_count;
$$;
