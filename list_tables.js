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
        const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
        console.log("Tables in public schema:");
        res.rows.forEach(r => console.log(` - ${r.table_name}`));

        // Check if okk_violations exists and its structure
        const checkViolations = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'okk_violations';
    `);
        if (checkViolations.rows.length > 0) {
            console.log("\nokk_violations structure:");
            checkViolations.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type})`));
        }
    } catch (e) {
        console.error("DB Error:", e.message);
    } finally {
        await client.end();
    }
}

run();
