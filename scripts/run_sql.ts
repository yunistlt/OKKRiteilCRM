import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql_conn = postgres(process.env.DATABASE_URL!);

async function run() {
    const query = process.argv[2];
    if (!query) {
        console.error('No SQL query provided');
        process.exit(1);
    }
    try {
        console.log('📝 Executing SQL:', query);
        await sql_conn.unsafe(query);
        console.log('✅ Success!');
    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        await sql_conn.end();
        process.exit(0);
    }
}
run();
