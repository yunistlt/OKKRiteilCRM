const postgres = require('postgres');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('Missing DATABASE_URL in .env.local');
    process.exit(1);
}

const sql_conn = postgres(databaseUrl, { ssl: 'require' });

async function runMigration(filePath) {
    console.log(`Running migration from file: ${filePath}`);
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    try {
        // We can execute multiple statements in one call with postgres-js
        await sql_conn.unsafe(sqlContent);
        console.log(`Successfully ran migration: ${filePath}`);
    } catch (error) {
        console.error(`Error running migration ${filePath}:`, error);
        process.exit(1);
    } finally {
        await sql_conn.end();
    }
}

const migrationFile = path.join(__dirname, '../migrations/20260330_unify_vector_kbs.sql');
runMigration(migrationFile);
