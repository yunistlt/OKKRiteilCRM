-- Create table for RetailCRM dictionaries and reference labels
CREATE TABLE IF NOT EXISTS retailcrm_dictionaries (
    id serial PRIMARY KEY,
    entity_type text NOT NULL, -- 'orderMethod', 'status', 'customField'
    dictionary_code text,      -- e.g., 'sfera_deiatelnosti' (null for orderMethods)
    item_code text NOT NULL,   -- technical code (e.g., 'bank-1')
    item_name text NOT NULL,   -- human name (e.g., 'Банк')
    updated_at timestamptz DEFAULT now(),
    UNIQUE(entity_type, dictionary_code, item_code)
);

-- Enable RLS
ALTER TABLE retailcrm_dictionaries ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow public read" ON retailcrm_dictionaries FOR SELECT USING (true);
CREATE POLICY "Allow service_role full access" ON retailcrm_dictionaries USING (true) WITH CHECK (true);

-- Permissions
GRANT ALL ON retailcrm_dictionaries TO anon, authenticated, service_role;
