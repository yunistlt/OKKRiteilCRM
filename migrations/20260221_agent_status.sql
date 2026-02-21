-- Create table to track AI Agents activity
CREATE TABLE IF NOT EXISTS public.okk_agent_status (
    agent_id TEXT PRIMARY KEY, -- 'anna', 'maxim', 'igor', 'semen'
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT DEFAULT 'idle', -- 'idle', 'working', 'busy', 'offline'
    current_task TEXT, -- Description of what they are doing right now
    last_active_at TIMESTAMPTZ DEFAULT now(),
    avatar_url TEXT
);

-- Initial population
INSERT INTO public.okk_agent_status (agent_id, name, role, status, current_task, last_active_at)
VALUES 
('anna', 'Анна', 'Бизнес-аналитик', 'idle', 'Ожидает новых сделок для разбора', now()),
('maxim', 'Максим', 'Аудитор', 'idle', 'Готов к проверке звонков', now()),
('igor', 'Игорь', 'Диспетчер', 'idle', 'Следит за общим потоком в CRM', now()),
('semen', 'Семён', 'Архивариус', 'working', 'Раскладывает данные по полкам (синхронизация)', now())
ON CONFLICT (agent_id) DO NOTHING;
