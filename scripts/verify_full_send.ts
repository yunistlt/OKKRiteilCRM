const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
const { generateReactivationEmail } = require('./lib/reactivation');

// Mocking required worker logic
const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function retailcrmFetch(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${RETAILCRM_URL}${path}${sep}apiKey=${RETAILCRM_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RetailCRM ${path} → HTTP ${res.status}`);
    return res.json();
}

async function updateCorporateFields(customerId, emailBody, lastOrderNumber) {
    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('customerCorporate[customFields][ai_reactivation_text]', emailBody);
    if (lastOrderNumber) {
        params.set('customerCorporate[customFields][ai_last_order_number]', String(lastOrderNumber));
    }

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        throw new Error(`RetailCRM corporate/edit failed: ${res.status}`);
    }
}

async function run() {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();

    console.log('--- Send Mechanism TEST ---');

    // 1. Get the PENDING log we created earlier
    const logRes = await pg.query("SELECT * FROM ai_outreach_logs WHERE status = 'pending' LIMIT 1");
    if (logRes.rows.length === 0) {
        console.log('No pending logs found.');
        await pg.end();
        return;
    }
    const log = logRes.rows[0];
    console.log(`Processing Log ID: ${log.id} for ${log.company_name}`);

    // --- STAGE 1: DRAFTING ---
    console.log('1. Generating AI Draft...');
    const customerRes = await retailcrmFetch(`/api/v5/customers-corporate/${log.customer_id}`);
    const customer = customerRes.customerCorporate || {};
    
    // Simplifed context for test
    const result = await generateReactivationEmail({
        company_name: log.company_name,
        contact_person: 'Тестовый Контакт',
        orders_history: 'Заказ #1: 1000 руб, Заказ #2: 5000 руб',
        manager_comments: 'Клиент лояльный, но давно не заказывал.',
    });

    await pg.query(
        "UPDATE ai_outreach_logs SET generated_email = $1, justification = $2, status = 'awaiting_approval' WHERE id = $3",
        [result.body, result.reasoning, log.id]
    );
    console.log('✅ Draft generated. Status: awaiting_approval');

    // --- STAGE 2: APPROVAL (Manual simulated) ---
    console.log('2. Simulating User Approval...');
    await pg.query("UPDATE ai_outreach_logs SET status = 'approved' WHERE id = $1", [log.id]);
    console.log('✅ Status updated to: approved');

    // --- STAGE 3: SENDING ---
    console.log('3. Dispatching to RetailCRM...');
    try {
        await updateCorporateFields(log.customer_id, result.body, 'TEST-123');
        await pg.query("UPDATE ai_outreach_logs SET status = 'sent', sent_at = NOW() WHERE id = $1", [log.id]);
        console.log('🎉 SUCCESS! Log marked as SENT. CRM fields updated.');
    } catch (e) {
        console.error('❌ SEND FAILED:', e.message);
    }

    await pg.end();
}

run().catch(console.error);
