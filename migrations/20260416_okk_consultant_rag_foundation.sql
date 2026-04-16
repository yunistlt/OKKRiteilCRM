CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS max_tokens integer;
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_prompts ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_key_active ON public.ai_prompts(key, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_embedding ON public.ai_prompts USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.okk_consultant_knowledge (
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

CREATE INDEX IF NOT EXISTS idx_okk_consultant_knowledge_section_type ON public.okk_consultant_knowledge(section_key, type);
CREATE INDEX IF NOT EXISTS idx_okk_consultant_knowledge_active ON public.okk_consultant_knowledge(is_active, section_key);
CREATE INDEX IF NOT EXISTS idx_okk_consultant_knowledge_embedding ON public.okk_consultant_knowledge USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.okk_consultant_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS okk_consultant_knowledge_select ON public.okk_consultant_knowledge;
CREATE POLICY okk_consultant_knowledge_select
ON public.okk_consultant_knowledge
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS okk_consultant_knowledge_service_role_write ON public.okk_consultant_knowledge;
CREATE POLICY okk_consultant_knowledge_service_role_write
ON public.okk_consultant_knowledge
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON public.okk_consultant_knowledge TO authenticated;
GRANT ALL ON public.okk_consultant_knowledge TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.match_okk_consultant_knowledge(
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
    FROM public.okk_consultant_knowledge k
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
    'okk_consultant_main_chat',
    'Main system prompt for OKK consultant fallback answers',
    'Ты консультант-методолог по ОКК. Отвечай только по данным из контекста и найденных знаний. Не выдумывай поля, звонки, формулы, правила и причины. Если данных недостаточно, скажи это прямо одной фразой. Не старайся угодить. Не используй длинные вступления, смягчения и общие рассуждения.',
    'Вопрос: {{question}}\nРаздел: {{section_title}}\nКраткое описание раздела: {{section_summary}}\n\nРелевантные знания:\n{{knowledge_context}}\n\nИстория диалога:\n{{history_context}}\n\nКонтекст заказа:\n{{order_context}}',
    'gpt-4o-mini',
    0.05,
    280,
    '{"owner":"okk_consultant","stage":"production"}'::jsonb,
    true
),
(
    'okk_consultant_style_guardrail',
    'Style guardrail for concise OKK consultant answers',
    'Формат ответа: 1) прямой вывод, 2) до трех коротких фактов, 3) следующий шаг только если он реально нужен. Пиши кратко и по делу. Запрещено: вода, повтор вопроса, комплименты, канцелярит, длинные списки, уверенные догадки без опоры на контекст. Если есть неопределенность, обозначь ее одной короткой строкой.',
    '',
    'gpt-4o-mini',
    0.05,
    220,
    '{"owner":"okk_consultant","stage":"production","style":"concise"}'::jsonb,
    true
)
ON CONFLICT (key) DO NOTHING;