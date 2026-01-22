
-- 1. Create Blocks Library Table
CREATE TABLE IF NOT EXISTS okk_block_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL, -- trigger, condition, action
    name TEXT NOT NULL,
    description TEXT,
    ai_prompt TEXT,
    params_schema JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add logic column to okk_rules
ALTER TABLE okk_rules ADD COLUMN IF NOT EXISTS logic JSONB;

-- 3. Seed Initial Blocks
INSERT INTO okk_block_definitions (code, type, name, description, ai_prompt, params_schema)
VALUES 
('status_change', 'trigger', 'Смена статуса', 'Срабатывает при переходе заказа в указанный статус или из него.', 'Используй этот триггер для отслеживания смены статусов. Параметры: target_status (код статуса), direction (to/from).', '{"fields": [{"name": "target_status", "type": "string", "description": "Код целевого статуса"}, {"name": "direction", "type": "enum", "options": ["to", "from"], "default": "to"}]}'),
('field_empty', 'condition', 'Пустое поле', 'Проверяет, что указанное поле (например, комментарий) не заполнено.', 'Используй для проверки отсутствия комментариев или данных в полях CRM. Параметры: field_path (например, manager_comment).', '{"fields": [{"name": "field_path", "type": "string", "description": "Путь к полю (например, manager_comment)"}]}'),
('time_elapsed', 'condition', 'Прошло времени', 'Проверка, что с момента события прошло более X часов.', 'Используй для контроля задержек и застоя заказов. Параметры: hours (число).', '{"fields": [{"name": "hours", "type": "number", "description": "Количество часов задержки"}]}'),
('call_exists', 'condition', 'Наличие звонка', 'Проверяет наличие успешного звонка в заданном интервале времени.', 'Используй, чтобы проверить, звонил ли менеджер клиенту. Параметры: window_hours (интервал поиска).', '{"fields": [{"name": "window_hours", "type": "number", "description": "Окно поиска звонка в часах"}, {"name": "min_duration", "type": "number", "description": "Мин. длительность в сек"}]}'),
('semantic_check', 'condition', 'Смысловой анализ (AI)', 'Глубокий анализ текста (комментария или транскрипта) через GPT.', 'Используй для проверки качества текста, вежливости или наличия конкретных смыслов. Параметры: prompt (текст инструкции для ИИ).', '{"fields": [{"name": "prompt", "type": "string", "description": "Инструкция для анализа"}]}');
