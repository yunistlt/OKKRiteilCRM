
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function audit() {
    console.log('🔌 Connecting via PG...');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

        // 1. Group by Transcription Status (The smoking gun check)
        console.log('\n📊 Calls by Transcription Status (Last 72h based on started_at):');
        const resStatus = await client.query(`
            SELECT transcription_status, COUNT(*) 
            FROM raw_telphin_calls 
            WHERE started_at > $1
            GROUP BY transcription_status
        `, [threeDaysAgo]);
        console.table(resStatus.rows);

        // 2. Count Violations (Cheap-ish)
        const resViols = await client.query(`
            SELECT COUNT(*) 
            FROM okk_violations 
            WHERE violation_time > $1
        `, [threeDaysAgo]);
        console.log(`👮 Violation Checks (by violation_time): ${resViols.rows[0].count}`);

    } catch (err) {
        console.error('PG Error:', err);
    } finally {
        await client.end();
    }
}

audit();
