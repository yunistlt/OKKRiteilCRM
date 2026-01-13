
-- Add Foreign Key from raw_order_events to order_metrics
-- This enables PostgREST resource embedding: raw_order_events(..., order_metrics(...))

DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_raw_order_events_metrics'
    ) THEN 
        ALTER TABLE raw_order_events
        ADD CONSTRAINT fk_raw_order_events_metrics
        FOREIGN KEY (retailcrm_order_id)
        REFERENCES order_metrics (retailcrm_order_id);
    END IF;
END $$;
