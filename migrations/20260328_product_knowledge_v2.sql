-- Table for storing products technical knowledge (Productologist's workspace)
CREATE TABLE IF NOT EXISTS product_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT UNIQUE, -- Article/SKU from RetailCRM
    name TEXT NOT NULL,
    category TEXT, -- Locker, Drying Cabinet, etc.
    description TEXT, -- General technical/marketing description
    tech_specs JSONB, -- Structured data: { "dimensions": "1800x800x500", "weight": "40kg", "material": "Steel" }
    source_url TEXT, -- Primary URL on zmktlt.ru
    competitor_urls TEXT[], -- Array of competitor links for context
    competitor_notes TEXT, -- Highlights from other sources
    last_studied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for searching by name and SKU
CREATE INDEX IF NOT EXISTS idx_product_knowledge_sku ON product_knowledge(sku);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_name ON product_knowledge(name);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_product_knowledge_modtime
    BEFORE UPDATE ON product_knowledge
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();
