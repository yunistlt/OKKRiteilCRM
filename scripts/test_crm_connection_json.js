require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId) {
    console.log(`Testing RetailCRM update (JSON) for Customer ID: ${customerId}`);
    
    const body = {
        customerCorporate: {
            customFields: {
                ai_reactivation_text: 'TEST MESSAGE JSON: ' + new Date().toISOString()
            }
        }
    };

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?${params.toString()}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (res.ok && data.success) {
        console.log('✅ CRM Update Success:', data.success);
    } else {
        console.error('❌ CRM Update Failed:', res.status, JSON.stringify(data));
    }
}

testCrmUpdate(43091).catch(console.error);
