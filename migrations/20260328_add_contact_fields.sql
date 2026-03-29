-- ============================================================
-- Добавление полей контактного лица для B2B-реактивации
-- ============================================================

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS main_contact_id BIGINT,
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- Обновление функции upsert_clients для поддержки новых полей
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
            source,
            company_name,
            inn,
            kpp,
            contragent_type,
            main_contact_id, -- NEW
            contact_name,     -- NEW
            contact_email    -- NEW
        )
        VALUES (
            (client_record->>'id')::BIGINT,
            client_record->>'external_id',
            client_record->>'first_name',
            client_record->>'last_name',
            client_record->>'patronymic',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(client_record->'phones', '[]'::JSONB))),
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
            client_record->>'source',
            client_record->>'company_name',
            client_record->>'inn',
            client_record->>'kpp',
            client_record->>'contragent_type',
            (client_record->>'main_contact_id')::BIGINT,
            client_record->>'contact_name',
            client_record->>'contact_email'
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
            source = EXCLUDED.source,
            company_name = EXCLUDED.company_name,
            inn = EXCLUDED.inn,
            kpp = EXCLUDED.kpp,
            contragent_type = EXCLUDED.contragent_type,
            main_contact_id = EXCLUDED.main_contact_id,
            contact_name = EXCLUDED.contact_name,
            contact_email = EXCLUDED.contact_email;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
