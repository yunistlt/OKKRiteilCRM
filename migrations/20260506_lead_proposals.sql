-- КП (коммерческие предложения) от менеджера/ИИ по сессии виджета

CREATE TABLE IF NOT EXISTS lead_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL REFERENCES widget_sessions(id) ON DELETE CASCADE,

    -- Содержимое КП
    title TEXT NOT NULL DEFAULT 'Коммерческое предложение',
    intro TEXT,                     -- AI-сгенерированный текст введения
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Формат item: { name, description, quantity, price, unit }
    discount_pct INTEGER DEFAULT 0, -- скидка в процентах (0-100)
    valid_until DATE,               -- срок действия

    -- Статус
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected')),

    -- Публичный доступ
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),

    -- Файл
    pdf_url TEXT,                   -- Supabase Storage URL

    -- Трекинг
    viewed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,

    -- Мета
    created_by TEXT,                -- email/id менеджера
    crm_note TEXT,                  -- что отправили в RetailCRM

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_proposals_session_idx ON lead_proposals (session_id);
CREATE INDEX IF NOT EXISTS lead_proposals_token_idx ON lead_proposals (token);
CREATE INDEX IF NOT EXISTS lead_proposals_status_idx ON lead_proposals (status);
CREATE INDEX IF NOT EXISTS lead_proposals_created_at_idx ON lead_proposals (created_at DESC);

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION update_lead_proposals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_proposals_updated_at_trigger
    BEFORE UPDATE ON lead_proposals
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_proposals_updated_at();

-- RLS
ALTER TABLE lead_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access" ON lead_proposals FOR ALL USING (false);
