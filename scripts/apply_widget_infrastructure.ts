import postgres from 'postgres';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql_conn = postgres(process.env.DATABASE_URL!);

async function runMigration() {
    console.log('🚀 Connecting to database for widget infrastructure migration...');
    try {
        const migrationSql = fs.readFileSync('migrations/20260502_widget_infrastructure.sql', 'utf8');
        console.log('📝 Executing migration: 20260502_widget_infrastructure.sql');
        
        await sql_conn.unsafe(migrationSql);
        console.log('✅ Migration executed successfully!');

    } catch (error) {
        console.error('❌ Migration error:', error);
    } finally {
        await sql_conn.end();
        process.exit(0);
    }
}

runMigration();
