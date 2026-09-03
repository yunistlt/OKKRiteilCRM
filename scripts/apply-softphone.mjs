import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error('❌ DATABASE_URL or POSTGRES_URL is not set in .env.local');
        process.exit(1);
    }

    const client = new Client({ connectionString });
    await client.connect();

    try {
        const sqlPath = path.join(__dirname, '..', 'migrations', '20260903_softphone_setup.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('⏳ Applying migration: 20260903_softphone_setup.sql');
        await client.query(sql);
        console.log('✅ Migration applied successfully!');
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigration();
