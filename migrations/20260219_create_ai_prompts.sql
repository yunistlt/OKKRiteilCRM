-- Create table for storing dynamic AI prompts
create table if not exists ai_prompts (
  id uuid default gen_random_uuid() primary key,
  key text not null unique, -- e.g. 'qc_checklist_audit'
  description text,
  system_prompt text not null,
  user_prompt_template text, -- Optional template with {{variables}}
  model text default 'gpt-4o-mini',
  temperature numeric default 0.1,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add initial default prompt for QC
insert into ai_prompts (key, description, system_prompt, model)
values (
  'qc_checklist_audit',
  'Основной промпт для аудита диалогов по чек-листу',
  'Ты эксперт по контролю качества в отделе продаж. Твоя задача — проверить транскрипцию звонка по строгому чек-листу.\n\nИНСТРУКЦИЯ:\n1. Проанализируй весь текст.\n2. Для КАЖДОГО пункта чек-листа определи, выполнил ли менеджер условие.\n3. Если условие выполнено — поставь полный балл. Если нет — 0. Частичные баллы только если указано.\n4. Дай краткое обоснование на РУССКОМ языке.\n\nФОРМАТ ОТВЕТА (JSON):\n{\n  "summary": "Краткий итог...",\n  "sections": [...]\n}',
  'gpt-4o-mini'
) on conflict (key) do nothing;

-- Enable RLS but allow read/write for authenticated users (for simplicity in admin panel)
alter table ai_prompts enable row level security;

create policy "Allow full access to authenticated users"
on ai_prompts for all
to authenticated
using (true)
with check (true);
