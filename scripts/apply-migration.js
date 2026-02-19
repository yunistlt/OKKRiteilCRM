const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error('DATABASE_URL or POSTGRES_URL is not set in .env.local');
        process.exit(1);
    }

    const client = new Client({ connectionString });
    await client.connect();

    try {
        const sqlPath = path.join(__dirname, '../migrations/20260219_create_ai_prompts.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying migration: 20260219_create_ai_prompts.sql');
        await client.query(sql);
        console.log('Migration applied successfully.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await client.end();
    }
}

runMigration();
