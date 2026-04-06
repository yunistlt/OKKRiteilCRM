const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const connectionString = process.env.NEXT_PUBLIC_SUPABASE_URL
        ? process.env.NEXT_PUBLIC_SUPABASE_URL.replace('https://', 'postgres://postgres:').replace('.supabase.co', '.supabase.co:5432/postgres') // This won't work simply because we need the DB password, which is usually in DIRECT_URL or DATABASE_URL.
        : null;

    // Let's check what env vars we actually have for DB connection
    console.log("Available env vars for DB:");
    console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
    console.log("DIRECT_URL exists:", !!process.env.DIRECT_URL);

    const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

    if (!dbUrl) {
        console.log("No direct DB URL found in .env.local");
        return;
    }

    const client = new Client({
        connectionString: dbUrl,
    });

    try {
        await client.connect();
        
        // Count total rows
        const countRes = await client.query('SELECT count(*) FROM retailcrm_dictionaries');
        console.log("TOTAL_ROWS:", countRes.rows[0].count);

        // List unique dictionary codes with their item counts
        const codesRes = await client.query(`
            SELECT dictionary_code, count(*) as item_count 
            FROM retailcrm_dictionaries 
            GROUP BY dictionary_code 
            ORDER BY dictionary_code;
        `);
        console.log("DICTIONARY_CODES_START");
        codesRes.rows.forEach(r => console.log(`${r.dictionary_code}|${r.item_count}`));
        console.log("DICTIONARY_CODES_END");

        // Fetch sample items for kategoriya_klienta to verify
        const samples = await client.query(`
            SELECT item_code, item_name 
            FROM retailcrm_dictionaries 
            WHERE dictionary_code = 'kategoriya_klienta'
            LIMIT 20;
        `);
        console.log("SAMPLES_START");
        samples.rows.forEach(r => console.log(`${r.item_code}|${r.item_name}`));
        console.log("SAMPLES_END");

    } catch (e) {
        console.error("DB Error:", e.message);
    } finally {
        await client.end();
    }
}

run();
