-- Окно балансировки распределения заявок секретаря (в днях).
-- «По нагрузке» = кому Катерина за последние N дней назначила меньше всего заявок.
ALTER TABLE public.email_intake_config
    ADD COLUMN IF NOT EXISTS balance_window_days INTEGER NOT NULL DEFAULT 7;
