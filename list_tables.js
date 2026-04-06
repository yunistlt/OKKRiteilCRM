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
        
        // Find dictionary_code for the problematic item
        const res = await client.query(`
            SELECT dictionary_code, item_code, item_name 
            FROM retailcrm_dictionaries 
            WHERE item_code = 'stoly-montazhnye' 
               OR item_code ILIKE '%stoly%'
            LIMIT 10;
        `);
        console.log("SEARCH_RESULT_START");
        res.rows.forEach(r => console.log(`${r.dictionary_code}|${r.item_code}|${r.item_name}`));
        console.log("SEARCH_RESULT_END");

        // List all category-related dictionary codes again just in case
        const codes = await client.query(`
            SELECT DISTINCT dictionary_code 
            FROM retailcrm_dictionaries 
            WHERE dictionary_code ILIKE '%category%' 
               OR dictionary_code ILIKE '%kategoriya%'
               OR dictionary_code ILIKE '%type%'
            LIMIT 20;
        `);
        console.log("CODES_START");
        codes.rows.forEach(r => console.log(r.dictionary_code));
        console.log("CODES_END");

    } catch (e) {
        console.error("DB Error:", e.message);
    } finally {
        await client.end();
    }
}

run();
