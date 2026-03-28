require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId) {
    console.log(`Testing RetailCRM update for Customer ID: ${customerId}`);
    
    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('customerCorporate[customFields][ai_reactivation_text]', 'TEST MESSAGE: ' + new Date().toISOString());

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (res.ok) {
        const data = await res.json();
        console.log('✅ CRM Update Success:', data.success);
    } else {
        const text = await res.text();
        console.error('❌ CRM Update Failed:', res.status, text);
    }
}

testCrmUpdate(43091).catch(console.error);
