-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id BIGINT PRIMARY KEY, -- RetailCRM ID
    external_id TEXT,
    first_name TEXT,
    last_name TEXT,
    patronymic TEXT,
    phones TEXT[],
    email TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    address JSONB,
    custom_fields JSONB,
    manager_id TEXT,
    site TEXT,
    vip BOOLEAN DEFAULT FALSE,
    bad BOOLEAN DEFAULT FALSE,
    personal_discount NUMERIC,
    cumulative_discount NUMERIC,
    source TEXT
);

-- Index for searching by phone (gin index for array)
CREATE INDEX IF NOT EXISTS idx_clients_phones ON clients USING GIN (phones);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);

-- RPC function to upsert clients
CREATE OR REPLACE FUNCTION upsert_clients(clients_data JSONB[])
RETURNS VOID AS $$
DECLARE
    client_record JSONB;
BEGIN
    FOREACH client_record IN ARRAY clients_data
    LOOP
        INSERT INTO clients (
            id,
            external_id,
            first_name,
            last_name,
            patronymic,
            phones,
            email,
            created_at,
            updated_at,
            address,
            custom_fields,
            manager_id,
            site,
            vip,
            bad,
            personal_discount,
            cumulative_discount,
            source
        )
        VALUES (
            (client_record->>'id')::BIGINT,
            client_record->>'external_id',
            client_record->>'first_name',
            client_record->>'last_name',
            client_record->>'patronymic',
            ARRAY(SELECT jsonb_array_elements_text(client_record->'phones')),
            client_record->>'email',
            (client_record->>'created_at')::TIMESTAMPTZ,
            (client_record->>'updated_at')::TIMESTAMPTZ,
            client_record->'address',
            client_record->'custom_fields',
            client_record->>'manager_id',
            client_record->>'site',
            COALESCE((client_record->>'vip')::BOOLEAN, FALSE),
            COALESCE((client_record->>'bad')::BOOLEAN, FALSE),
            (client_record->>'personal_discount')::NUMERIC,
            (client_record->>'cumulative_discount')::NUMERIC,
            client_record->>'source'
        )
        ON CONFLICT (id) DO UPDATE SET
            external_id = EXCLUDED.external_id,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            patronymic = EXCLUDED.patronymic,
            phones = EXCLUDED.phones,
            email = EXCLUDED.email,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            address = EXCLUDED.address,
            custom_fields = EXCLUDED.custom_fields,
            manager_id = EXCLUDED.manager_id,
            site = EXCLUDED.site,
            vip = EXCLUDED.vip,
            bad = EXCLUDED.bad,
            personal_discount = EXCLUDED.personal_discount,
            cumulative_discount = EXCLUDED.cumulative_discount,
            source = EXCLUDED.source;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
