
-- 1. Clean up "Orphan" events that have no matching Order Metric
-- These are invalid anyway for the rule engine as we can't check context.
DELETE FROM raw_order_events
WHERE retailcrm_order_id NOT IN (
    SELECT retailcrm_order_id FROM order_metrics
);

-- 2. Add Foreign Key
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
