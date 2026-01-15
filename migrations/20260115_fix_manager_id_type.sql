-- 1. CLEANUP: Remove invalid manager_ids that cannot be cast to integer
UPDATE "orders"
SET "manager_id" = NULL
WHERE "manager_id" = 'null' 
   OR "manager_id" = 'undefined' 
   OR "manager_id" !~ '^\d+$';

-- 2. ALTER: Change column type to bigint
ALTER TABLE "orders"
ALTER COLUMN "manager_id" TYPE bigint 
USING "manager_id"::bigint;

-- 2.5 CLEANUP: Nullify manager_ids that don't exist in managers table
-- This prevents FK violation errors for old/deleted managers
UPDATE "orders"
SET "manager_id" = NULL
WHERE "manager_id" IS NOT NULL 
AND "manager_id" NOT IN (SELECT "id" FROM "managers");

-- 3. CONSTRAINT: Add Foreign Key
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

-- 4. UPDATE UPSERT RPC (Important! Check if it needs update to accept bigints)
-- We should verify if the app code sends strings or numbers. 
-- Usually TS sends strings from JSON. The DB adapter might handle it, 
-- but to be safe, we should ensure the function signature allows flexibility or matches.
-- If the function accepts `json`, it parses text inside. 
-- No action needed on RPC if it takes json payload.
