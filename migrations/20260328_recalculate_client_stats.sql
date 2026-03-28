-- Function to recalculate client statistics based on the local orders table
CREATE OR REPLACE FUNCTION recalculate_all_client_stats()
RETURNS VOID AS $$
BEGIN
    -- Update clients table using aggregated data from orders table
    -- We join by client_id (integer) which is the CRM ID stored in both tables
    UPDATE clients c
    SET 
        orders_count = sub.cnt,
        total_summ = sub.total,
        average_check = CASE WHEN sub.cnt > 0 THEN sub.total / sub.cnt ELSE 0 END
    FROM (
        SELECT 
            client_id, 
            COUNT(*) as cnt, 
            SUM(COALESCE(totalsumm, 0)) as total
        FROM orders
        WHERE client_id IS NOT NULL
        GROUP BY client_id
    ) sub
    WHERE c.id = sub.client_id;
    
    -- Also handle clients with 0 orders (to be safe)
    UPDATE clients
    SET 
        orders_count = 0,
        total_summ = 0,
        average_check = 0
    WHERE id NOT IN (SELECT DISTINCT client_id FROM orders WHERE client_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql;
