-- Расширение widget_sessions: контактные данные + привязка к CRM + метаданные чата
-- Эти колонки используются в: lead-catcher, cron/lead-reminders, proposals API

ALTER TABLE public.widget_sessions
    ADD COLUMN IF NOT EXISTS nickname TEXT,
    ADD COLUMN IF NOT EXISTS has_contacts BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS interested_products TEXT[],
    ADD COLUMN IF NOT EXISTS contact_name TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS contact_company TEXT,
    ADD COLUMN IF NOT EXISTS crm_order_id BIGINT,
    ADD COLUMN IF NOT EXISTS crm_customer_id BIGINT,
    ADD COLUMN IF NOT EXISTS manager_took_over BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS manager_notes TEXT;

-- Индекс для фильтрации по email в cron-напоминаниях
CREATE INDEX IF NOT EXISTS idx_widget_sessions_contact_email ON public.widget_sessions(contact_email) WHERE contact_email IS NOT NULL;

-- Индекс для cron: ищем сессии без контактов с товарами (abandoned_cart)
CREATE INDEX IF NOT EXISTS idx_widget_sessions_no_contacts ON public.widget_sessions(created_at) WHERE has_contacts = false AND interested_products IS NOT NULL;

-- Индекс для связки с RetailCRM
CREATE INDEX IF NOT EXISTS idx_widget_sessions_crm_order ON public.widget_sessions(crm_order_id) WHERE crm_order_id IS NOT NULL;
