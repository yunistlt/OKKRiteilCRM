
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config({ path: '.env.local' });

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('POSTGRES_URL or DATABASE_URL is missing in .env.local');
    process.exit(1);
}

const sql = postgres(connectionString, {
    ssl: 'require',
    max: 1
});

async function run() {
    try {
        console.log('Applying migration...');
        const migrationPath = 'migrations/20260115_extended_matching_window.sql';
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        await sql.unsafe(migrationSql);
        console.log('Migration applied successfully!');
    } catch (e: any) {
        console.error('Migration failed:', e);
    } finally {
        await sql.end();
    }
}

run();
