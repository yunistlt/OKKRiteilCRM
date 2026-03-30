-- Enable pgvector extension
create extension if not exists vector;

-- Add embedding column to training_examples
-- Assuming we use OpenAI text-embedding-3-small (1536 dimensions)
alter table training_examples 
add column if not exists embedding vector(1536);

-- Create HNSW index for faster similarity search
-- Note: m=16, ef_construction=64 are common defaults
create index if not exists idx_training_examples_embedding 
on training_examples using hnsw (embedding vector_cosine_ops);

-- Function to search for similar training examples
create or replace function match_training_examples (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id int,
  order_id int,
  order_number text,
  traffic_light text,
  user_reasoning text,
  order_context jsonb,
  created_at timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    te.id,
    te.order_id,
    te.order_number,
    te.traffic_light,
    te.user_reasoning,
    te.order_context,
    te.created_at,
    1 - (te.embedding <=> query_embedding) as similarity
  from training_examples te
  where 1 - (te.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
end;
$$;
