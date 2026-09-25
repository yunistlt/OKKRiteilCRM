-- Пороги ежедневной проверки здоровья ИИ-контура (без хардкода в коде).
--
-- silence_hours     — сколько часов тишины агентов в рабочее время считать поломкой
-- queue_stuck       — с какого числа задач в очереди поднимать тревогу
-- dead_letter_alert — с какого числа «мёртвых» задач за сутки поднимать тревогу
-- spike_pct         — на сколько процентов расход за сутки должен превысить среднюю
--                     за неделю, чтобы это считать скачком
alter table ai_cost_settings add column if not exists health_silence_hours numeric not null default 6;
alter table ai_cost_settings add column if not exists health_queue_stuck integer not null default 300;
alter table ai_cost_settings add column if not exists health_dead_letter_alert integer not null default 20;
alter table ai_cost_settings add column if not exists health_spike_pct numeric not null default 60;
