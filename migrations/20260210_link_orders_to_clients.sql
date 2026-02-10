-- Add client_id to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id BIGINT;

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_client'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_client
        FOREIGN KEY (client_id)
        REFERENCES clients(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- Create index for client_id
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);

-- Update upsert_orders_v2 to handle client_id
-- We need to check if the client exists, if not, we might want to create a stub or just link if exists.
-- For now, let's just update the logic to extract client.id from the payload and save it.

CREATE OR REPLACE FUNCTION upsert_orders_v2(orders_data JSONB[])
RETURNS VOID AS $$
DECLARE
    order_record JSONB;
    derived_client_id BIGINT;
BEGIN
    FOREACH order_record IN ARRAY orders_data
    LOOP
        -- Extract client_id from the raw payload if available
        -- RetailCRM structure: order.customer.id
        derived_client_id := (order_record->'raw_payload'->'customer'->>'id')::BIGINT;

        INSERT INTO orders (
            id,
            order_id,
            created_at,
            updated_at,
            number,
            status,
            site,
            event_type,
            manager_id,
            phone,
            customer_phones,
            totalsumm,
            raw_payload,
            client_id -- New field
        )
        VALUES (
            (order_record->>'id')::BIGINT,
            (order_record->>'order_id')::BIGINT,
            (order_record->>'created_at')::TIMESTAMPTZ,
            (order_record->>'updated_at')::TIMESTAMPTZ,
            order_record->>'number',
            order_record->>'status',
            order_record->>'site',
            order_record->>'event_type',
            order_record->>'manager_id',
            order_record->>'phone',
            ARRAY(SELECT jsonb_array_elements_text(order_record->'customer_phones')),
            (order_record->>'totalsumm')::NUMERIC,
            order_record->'raw_payload',
            derived_client_id -- New value
        )
        ON CONFLICT (id) DO UPDATE SET
            order_id = EXCLUDED.order_id,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            number = EXCLUDED.number,
            status = EXCLUDED.status,
            site = EXCLUDED.site,
            event_type = EXCLUDED.event_type,
            manager_id = EXCLUDED.manager_id,
            phone = EXCLUDED.phone,
            customer_phones = EXCLUDED.customer_phones,
            totalsumm = EXCLUDED.totalsumm,
            raw_payload = EXCLUDED.raw_payload,
            client_id = EXCLUDED.client_id; -- Update logic
    END LOOP;
END;
$$ LANGUAGE plpgsql;
