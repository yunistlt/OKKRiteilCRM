import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('POSTGRES_URL or DATABASE_URL is missing in .env.local');
    process.exit(1);
}

const sql = postgres(connectionString, {
    ssl: 'require',
    max: 1,
});

async function run() {
    const migrationPath = path.join(process.cwd(), 'migrations/20260414_okk_consultant_schema.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    try {
        console.log('Applying migration: 20260414_okk_consultant_schema.sql');
        await sql.unsafe(migrationSql);
        console.log('Migration applied successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

void run();