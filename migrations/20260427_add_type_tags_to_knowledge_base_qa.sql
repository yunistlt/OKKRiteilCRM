-- Миграция: добавление полей type и tags в knowledge_base_qa
alter table knowledge_base_qa
add column if not exists type varchar default 'question',
add column if not exists tags jsonb default '[]';
