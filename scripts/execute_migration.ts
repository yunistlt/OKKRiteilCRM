import postgres from 'postgres';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql_conn = postgres(process.env.DATABASE_URL!);

async function runMigration() {
    console.log('🚀 Connecting to database for migration...');
    try {
        const migrationSql = fs.readFileSync('migrations/20260328_recalculate_client_stats.sql', 'utf8');
        console.log('📝 Executing migration: recalculate_all_client_stats.sql');
        
        await sql_conn.unsafe(migrationSql);
        console.log('✅ Migration executed successfully!');

        console.log('🔄 Triggering full recalculation of client stats...');
        await sql_conn`SELECT recalculate_all_client_stats();`;
        console.log('✨ All client statistics have been recalculated from order history!');

    } catch (error) {
        console.error('❌ Migration/Recalculation error:', error);
    } finally {
        await sql_conn.end();
        process.exit(0);
    }
}

runMigration();
