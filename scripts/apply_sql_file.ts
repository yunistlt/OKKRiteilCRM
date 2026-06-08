import postgres from 'postgres';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Переиспользуемый раннер миграций: путь к .sql передаётся аргументом.
// Использование: tsx scripts/apply_sql_file.ts migrations/<file>.sql
async function run() {
    const file = process.argv[2];
    if (!file) {
        console.error('Usage: tsx scripts/apply_sql_file.ts <path-to-sql>');
        process.exit(1);
    }
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error('DATABASE_URL / POSTGRES_URL is not set in .env.local');
        process.exit(1);
    }
    const sql = postgres(connectionString);
    try {
        const content = fs.readFileSync(file, 'utf8');
        console.log(`📝 Applying: ${file}`);
        await sql.unsafe(content);
        console.log('✅ Applied successfully.');
    } catch (e) {
        console.error('❌ Error:', e);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}
run();
