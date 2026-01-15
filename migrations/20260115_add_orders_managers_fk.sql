-- Add Foreign Key from orders.manager_id to managers.id if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_managers' 
        AND table_name = 'orders'
    ) THEN 
        ALTER TABLE "orders" 
        ADD CONSTRAINT "fk_orders_managers" 
        FOREIGN KEY ("manager_id") 
        REFERENCES "managers" ("id") 
        ON DELETE SET NULL;
    END IF; 
END $$;
