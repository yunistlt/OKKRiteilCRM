
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function clearViolations() {
    console.log('Connecting to DB...');
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('Connected. Clearing okk_violations...');

        // Delete all rows
        const res = await client.query('DELETE FROM okk_violations');
        console.log(`Deleted ${res.rowCount} violations.`);

    } catch (err) {
        console.error('Error clearing violations:', err);
    } finally {
        await client.end();
    }
}

clearViolations();
