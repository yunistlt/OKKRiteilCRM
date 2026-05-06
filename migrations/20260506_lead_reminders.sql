-- Таблица напоминаний / уведомлений по лидам
-- Хранит запланированные и отправленные напоминания по трём сценариям:
-- 1. abandoned_cart   — лид смотрел товары, но не оставил контакт (уведомление менеджеру)
-- 2. no_manager_reply — клиент написал, менеджер не ответил > 4 часа
-- 3. reactivation     — лид > 7 дней без движения, есть email клиента

CREATE TABLE IF NOT EXISTS lead_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL REFERENCES widget_sessions(id) ON DELETE CASCADE,

    type TEXT NOT NULL CHECK (type IN ('abandoned_cart', 'no_manager_reply', 'reactivation')),

    -- Кому отправлено
    recipient_email TEXT,           -- email клиента (если есть)
    manager_email TEXT,             -- email менеджера (уведомление)

    -- Статус
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),

    -- Служебное
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Один тип напоминания на одну сессию (не дублировать)
CREATE UNIQUE INDEX IF NOT EXISTS lead_reminders_session_type_unique
    ON lead_reminders (session_id, type);

-- Индекс для cron-запроса
CREATE INDEX IF NOT EXISTS lead_reminders_status_idx ON lead_reminders (status);
CREATE INDEX IF NOT EXISTS lead_reminders_created_at_idx ON lead_reminders (created_at DESC);

-- RLS
ALTER TABLE lead_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access" ON lead_reminders FOR ALL USING (false);
