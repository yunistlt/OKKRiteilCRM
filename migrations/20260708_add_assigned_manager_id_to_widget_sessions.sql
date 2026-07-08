-- Добавляем колонку assigned_manager_id в таблицу widget_sessions для централизации распределения заявок.
ALTER TABLE public.widget_sessions ADD COLUMN IF NOT EXISTS assigned_manager_id BIGINT;

-- Индекс для ускорения запросов к крон-задачам и балансировщику
CREATE INDEX IF NOT EXISTS idx_widget_sessions_assigned_manager_id ON public.widget_sessions(assigned_manager_id) WHERE assigned_manager_id IS NOT NULL;
