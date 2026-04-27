-- Миграция: добавить customer_questions_asked и customer_pains_voiced в order_metrics
alter table order_metrics
add column if not exists customer_questions_asked jsonb default '[]',
add column if not exists customer_pains_voiced jsonb default '[]';
