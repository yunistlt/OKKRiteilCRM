
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const dbConfig = { connectionString: process.env.DATABASE_URL };

async function run() {
    console.log("🚀 Starting Full Stats Calculation (LTV) for all clients...");
    const client = new Client(dbConfig);
    await client.connect();

    try {
        console.log("🔍 Extracting aggregated stats from orders.raw_payload...");
        
        // 1. Bulk update using a single query to be fast
        const updateQuery = `
            WITH latest_stats AS (
                SELECT 
                    (raw_payload->'customer'->>'id')::bigint as c_id,
                    MAX((raw_payload->'customer'->>'ordersCount')::int) as c_count,
                    MAX((raw_payload->'customer'->>'totalSumm')::numeric) as c_total,
                    MAX((raw_payload->>'createdAt')::timestamp) as last_order
                FROM orders
                WHERE raw_payload->'customer'->>'id' IS NOT NULL
                  AND (raw_payload->'customer'->>'ordersCount')::int > 0
                GROUP BY 1
            )
            UPDATE clients 
            SET 
                orders_count = ls.c_count, 
                total_summ = ls.c_total, 
                last_order_at = ls.last_order,
                average_check = CASE WHEN ls.c_count > 0 THEN ls.c_total / ls.c_count ELSE 0 END
            FROM latest_stats ls
            WHERE clients.id = ls.c_id;
        `;

        const res = await client.query(updateQuery);
        console.log(`✅ Successfully updated stats (LTV + Last Order Date) for ${res.rowCount} clients.`);

    } catch (err) {
        console.error("❌ Stats Update Error:", err.message);
    } finally {
        await client.end();
        console.log("🏁 Stats calculation complete.");
    }
}

run();
