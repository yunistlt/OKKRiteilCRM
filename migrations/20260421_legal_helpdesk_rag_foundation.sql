CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS max_tokens integer;
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_key_active ON public.ai_prompts(key, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_embedding ON public.ai_prompts USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.legal_consultant_knowledge (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    type text NOT NULL,
    section_key text,
    title text NOT NULL,
    content text NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    source_ref text,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    embedding vector(1536),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_consultant_knowledge_section_type ON public.legal_consultant_knowledge(section_key, type);
CREATE INDEX IF NOT EXISTS idx_legal_consultant_knowledge_active ON public.legal_consultant_knowledge(is_active, section_key);
CREATE INDEX IF NOT EXISTS idx_legal_consultant_knowledge_embedding ON public.legal_consultant_knowledge USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.legal_consultant_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_consultant_knowledge_select ON public.legal_consultant_knowledge;
CREATE POLICY legal_consultant_knowledge_select
ON public.legal_consultant_knowledge
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS legal_consultant_knowledge_service_role_write ON public.legal_consultant_knowledge;
CREATE POLICY legal_consultant_knowledge_service_role_write
ON public.legal_consultant_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON public.legal_consultant_knowledge TO authenticated;
GRANT ALL ON public.legal_consultant_knowledge TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.match_legal_consultant_knowledge(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    requested_section_key text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    slug text,
    type text,
    section_key text,
    title text,
    content text,
    tags text[],
    source_ref text,
    metadata jsonb,
    similarity float
)
LANGUAGE sql
AS $$
    SELECT
        k.id,
        k.slug,
        k.type,
        k.section_key,
        k.title,
        k.content,
        k.tags,
        k.source_ref,
        k.metadata,
        1 - (k.embedding <=> query_embedding) AS similarity
    FROM public.legal_consultant_knowledge k
    WHERE k.is_active = true
      AND k.embedding IS NOT NULL
      AND 1 - (k.embedding <=> query_embedding) > match_threshold
      AND (
        requested_section_key IS NULL
        OR k.section_key IS NULL
        OR k.section_key = requested_section_key
      )
    ORDER BY similarity DESC
    LIMIT match_count;
$$;

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
    'legal_consultant_main_chat',
    'Main system prompt for legal consultant fallback answers',
    'Ты внутренний юрисконсульт компании. Отвечай только по данным из контекста и найденных знаний. Не выдумывай нормативные ссылки, штрафы, внутренние правила, сроки и полномочия. Если знаний недостаточно или вопрос выходит за покрытие базы, прямо скажи это и предложи эскалацию юристу. Для пользователей без legal-роли не раскрывай внутренние лимиты согласования, шаблоны санкций и служебные заметки.',
    'Вопрос: {{question}}\nIntent: {{intent}}\nРаздел: {{section_title}}\nСтратегия fallback: {{fallback_strategy}}\n\nРелевантные знания:\n{{knowledge_context}}\n\nИстория диалога:\n{{history_context}}\n\nСанитизированный контекст:\n{{sanitized_context}}',
    'gpt-4o-mini',
    0.05,
    360,
    '{"owner":"legal_consultant","stage":"production"}'::jsonb,
    true
),
(
    'legal_consultant_style_guardrail',
    'Style guardrail for concise legal consultant answers',
    'Формат ответа: 1) короткий вывод, 2) до трех конкретных оснований из базы знаний, 3) эскалация только если она действительно нужна. Не пиши длинных вступлений, не имитируй консультацию по закону вне корпоративной базы знаний, не делай уверенных догадок.',
    '',
    'gpt-4o-mini',
    0.05,
    220,
    '{"owner":"legal_consultant","stage":"production","style":"concise"}'::jsonb,
    true
)
ON CONFLICT (key) DO NOTHING;