-- Vectorizing all Knowledge Bases (KBs)
-- Requires pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Add embedding columns to target tables
ALTER TABLE product_knowledge ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE system_prompts ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE ai_prompts ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE okk_block_definitions ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 2. Create HNSW indexes for faster similarity search
CREATE INDEX IF NOT EXISTS idx_product_knowledge_embedding ON product_knowledge USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_system_prompts_embedding ON system_prompts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_embedding ON ai_prompts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_okk_block_definitions_embedding ON okk_block_definitions USING hnsw (embedding vector_cosine_ops);

-- 3. Match function for product_knowledge
CREATE OR REPLACE FUNCTION match_product_knowledge (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  sku TEXT,
  name TEXT,
  category TEXT,
  description TEXT,
  tech_specs JSONB,
  use_cases TEXT[],
  solved_tasks TEXT[],
  pain_points TEXT[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pk.id,
    pk.sku,
    pk.name,
    pk.category,
    pk.description,
    pk.tech_specs,
    pk.use_cases,
    pk.solved_tasks,
    pk.pain_points,
    1 - (pk.embedding <=> query_embedding) AS similarity
  FROM product_knowledge pk
  WHERE 1 - (pk.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 4. Match function for prompts (generic for both system and ai_prompts)
CREATE OR REPLACE FUNCTION match_prompts (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  prompt_table text
)
RETURNS TABLE (
  key text,
  content text,
  description text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF prompt_table = 'system_prompts' THEN
    RETURN QUERY
    SELECT
      sp.key,
      sp.content,
      sp.description,
      1 - (sp.embedding <=> query_embedding) AS similarity
    FROM system_prompts sp
    WHERE 1 - (sp.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
  ELSIF prompt_table = 'ai_prompts' THEN
    RETURN QUERY
    SELECT
      ap.key,
      ap.system_prompt as content,
      ap.description,
      1 - (ap.embedding <=> query_embedding) AS similarity
    FROM ai_prompts ap
    WHERE 1 - (ap.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
  END IF;
END;
$$;

-- 5. Match function for okk_block_definitions
CREATE OR REPLACE FUNCTION match_okk_blocks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  ai_prompt TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bd.id,
    bd.code,
    bd.name,
    bd.description,
    bd.ai_prompt,
    1 - (bd.embedding <=> query_embedding) AS similarity
  FROM okk_block_definitions bd
  WHERE 1 - (bd.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
