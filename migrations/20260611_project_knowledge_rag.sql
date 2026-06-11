-- Project-wide knowledge base for the "Семён" consultant.
-- Sibling table to okk_consultant_knowledge, but fed from the project's markdown docs
-- (chunked by heading) instead of the structured OKK catalog. Lets Семён answer
-- methodology questions across ALL sections (salary, messenger, reactivation, etc.).
-- Reuses the existing pgvector(1536) + HNSW + match_* pattern.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.project_knowledge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,            -- doc:<relPath>#<headingSlug>[#<chunkIdx>]
    source_path text NOT NULL,            -- 'docs/salary/OVERVIEW.md'
    subsystem text,                       -- 'salary' | 'messenger' | 'okk' | 'root' | ...
    heading text,                         -- breadcrumb of headings (H1 > H2 > H3)
    title text NOT NULL,
    content text NOT NULL,
    audience text NOT NULL DEFAULT 'all', -- 'all' (everyone) | 'staff' (admin/okk/rop only)
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    content_hash text,                    -- skip re-embedding unchanged chunks on re-seed
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_knowledge_subsystem ON public.project_knowledge(subsystem, audience);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_active ON public.project_knowledge(is_active, audience);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_embedding ON public.project_knowledge USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.project_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_knowledge_select ON public.project_knowledge;
CREATE POLICY project_knowledge_select
ON public.project_knowledge
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS project_knowledge_service_role_write ON public.project_knowledge;
CREATE POLICY project_knowledge_service_role_write
ON public.project_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON public.project_knowledge TO authenticated;
GRANT ALL ON public.project_knowledge TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.match_project_knowledge(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    allowed_audiences text[] DEFAULT ARRAY['all']
)
RETURNS TABLE (
    id uuid,
    slug text,
    source_path text,
    subsystem text,
    heading text,
    title text,
    content text,
    audience text,
    tags text[],
    metadata jsonb,
    similarity float
)
LANGUAGE sql
AS $$
    SELECT
        k.id,
        k.slug,
        k.source_path,
        k.subsystem,
        k.heading,
        k.title,
        k.content,
        k.audience,
        k.tags,
        k.metadata,
        1 - (k.embedding <=> query_embedding) AS similarity
    FROM public.project_knowledge k
    WHERE k.is_active = true
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> query_embedding) > match_threshold
      AND k.audience = ANY(allowed_audiences)
    ORDER BY similarity DESC
    LIMIT match_count;
$$;

-- Broadened persona prompt for the global (no-order) project-wide consultant path.
-- Separate key from okk_consultant_main_chat so the OKK order-analysis fallback is untouched.
INSERT INTO public.ai_prompts (
    key,
    description,
    system_prompt,
    user_prompt_template,
    model,
    temperature,
    max_tokens,
    metadata,
    is_active
)
VALUES
(
    'okk_consultant_global_chat',
    'System prompt for the project-wide Семён consultant (RAG over project docs)',
    'Ты Семён — консультант по всей системе OKKCRM: ОКК, зарплата ОП, мессенджер, реактивация, ловец лидов, юридические агенты, настройки. Отвечай строго по найденным знаниям из базы документации проекта. Не выдумывай поля, формулы, цифры, правила и процессы. Если в найденных знаниях нет ответа, честно скажи об этом одной фразой и предложи переформулировать вопрос. Все ответы на русском. Не старайся угодить, без длинных вступлений и общих рассуждений.',
    'Вопрос: {{question}}\nРаздел: {{section_title}}\n\nНайденные знания из документации:\n{{knowledge_context}}\n\nИстория диалога:\n{{history_context}}',
    'gpt-4o-mini',
    0.05,
    420,
    '{"owner":"okk_consultant","stage":"production","scope":"project-wide"}'::jsonb,
    true
)
ON CONFLICT (key) DO NOTHING;
