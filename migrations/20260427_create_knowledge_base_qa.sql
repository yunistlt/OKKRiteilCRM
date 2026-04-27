-- Создание таблицы knowledge_base_qa с необходимыми полями
create table if not exists knowledge_base_qa (
    id uuid primary key default gen_random_uuid(),
    intent_slug varchar not null unique,
    category varchar,
    question_variants jsonb,
    answer_website text,
    answer_consultant text,
    frequency_score int default 0,
    is_active boolean default true,
    type varchar default 'question',
    tags jsonb default '[]',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);