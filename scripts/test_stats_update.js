
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const dbConfig = { connectionString: process.env.DATABASE_URL };

async function run() {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        console.log("🔍 Finding clients with orders in raw_payload...");
        
        // 1. Get 5 clients and their latest stats from orders
        const statsRes = await client.query(`
            WITH latest_stats AS (
                SELECT 
                    (raw_payload->'customer'->>'id')::bigint as c_id,
                    (raw_payload->'customer'->>'nickName') as c_name,
                    (raw_payload->'customer'->>'ordersCount')::int as c_count,
                    (raw_payload->'customer'->>'totalSumm')::numeric as c_total,
                    ROW_NUMBER() OVER(PARTITION BY (raw_payload->'customer'->>'id') ORDER BY created_at DESC) as rn
                FROM orders
                WHERE raw_payload->'customer'->>'id' IS NOT NULL
                  AND (raw_payload->'customer'->>'ordersCount')::int > 0
            )
            SELECT c_id, c_name, c_count, c_total
            FROM latest_stats
            WHERE rn = 1
            LIMIT 5
        `);

        if (statsRes.rows.length === 0) {
            console.log("⚠️ No clients with order stats found in order history.");
            return;
        }

        console.log(`✨ Found ${statsRes.rows.length} test clients. Updating...`);

        for (const row of statsRes.rows) {
            const avg = row.c_count > 0 ? (row.c_total / row.c_count) : 0;
            
            await client.query(`
                UPDATE clients 
                SET orders_count = $1, total_summ = $2, average_check = $3
                WHERE id = $4
            `, [row.c_count, row.c_total, avg, row.c_id]);
            
            console.log(`✅ Updated: ${row.c_name} (ID: ${row.c_id}) | Заказов: ${row.c_count} | LTV: ${row.c_total} ₽ | Ср.чек: ${avg.toFixed(2)} ₽`);
        }

        console.log("\n🧪 Test run complete. Check the results above.");

    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}

run();
