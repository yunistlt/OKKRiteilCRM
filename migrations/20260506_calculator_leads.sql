-- Таблица лидов из интерактивных калькуляторов (СНОЛЕКС и др.)
-- Двухшаговая лид-генерация: Шаг 1 = email + спецификация, Шаг 2 = телефон + подарок → RetailCRM

CREATE TABLE IF NOT EXISTS calculator_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Шаг 1: Email + спецификация
    email TEXT NOT NULL,
    price INTEGER,
    specs JSONB,                -- {category_id, category_name, volume, temp, phase, ...}

    -- Шаг 2: Телефон + подарок
    phone TEXT,
    gift TEXT,
    step INTEGER NOT NULL DEFAULT 1,  -- 1 = только email, 2 = полный лид

    -- Интеграция
    crm_order_id TEXT,         -- ID заказа в RetailCRM (заполняется после Шага 2)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS calculator_leads_email_idx ON calculator_leads (email);
CREATE INDEX IF NOT EXISTS calculator_leads_created_at_idx ON calculator_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS calculator_leads_step_idx ON calculator_leads (step);
CREATE INDEX IF NOT EXISTS calculator_leads_specs_category_idx ON calculator_leads USING gin (specs);

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION update_calculator_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculator_leads_updated_at_trigger
    BEFORE UPDATE ON calculator_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_calculator_leads_updated_at();

-- RLS: читать может только аутентифицированный пользователь (service_role обходит RLS)
ALTER TABLE calculator_leads ENABLE ROW LEVEL SECURITY;

-- Сервисный ключ (используется в API) имеет полный доступ
-- Публичный доступ запрещён
CREATE POLICY "No public access" ON calculator_leads
    FOR ALL USING (false);
