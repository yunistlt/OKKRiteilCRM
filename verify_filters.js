const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    
    // Check total corporate clients
    const q1 = await client.query("SELECT count(*) FROM clients WHERE contragent_type IN ('Юридическое лицо', 'Индивидуальный предприниматель')");
    console.log('Total B2B clients:', q1.rows[0].count);

    // Check clients with at least 1 order
    const q2 = await client.query("SELECT count(*) FROM clients WHERE orders_count >= 1");
    console.log('Clients with 1+ orders:', q2.rows[0].count);

    // Check match for specific dashboard filter
    const query = `
        SELECT count(*) 
        FROM clients 
        WHERE 
            contragent_type IN ('Юридическое лицо', 'Индивидуальный предприниматель') 
            AND orders_count >= 1 
            AND (last_order_at < $1 OR last_order_at IS NULL)
    `;
    const res = await client.query(query, [cutoff]);
    console.log('Final Match Count (B2B, 1+ order, >6 months ago OR no recent date):', res.rows[0].count);
    
    await client.end();
}

run();
