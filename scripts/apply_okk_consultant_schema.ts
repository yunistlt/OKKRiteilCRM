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
    const migrationFiles = [
        '20260414_okk_consultant_schema.sql',
        '20260416_okk_consultant_rag_foundation.sql',
    ];

    try {
        for (const migrationFile of migrationFiles) {
            const migrationPath = path.join(process.cwd(), 'migrations', migrationFile);
            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            console.log(`Applying migration: ${migrationFile}`);
            await sql.unsafe(migrationSql);
        }

        console.log('All OKK consultant migrations applied successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

void run();