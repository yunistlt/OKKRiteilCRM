require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';
const RETAILCRM_SITE = process.env.RETAILCRM_SITE || 'zmktlt';

async function testCrmUpdate(customerId) {
    console.log(`Testing RetailCRM update (UrlEncoded JSON with SITE) for Customer ID: ${customerId}`);
    
    const customerData = {
        customFields: {
            ai_reactivation_text: 'TEST MESSAGE SUCCESSFUL: ' + new Date().toISOString()
        }
    };

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('site', RETAILCRM_SITE);
    params.set('customerCorporate', JSON.stringify(customerData));

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    const data = await res.json();
    if (res.ok && data.success) {
        console.log('✅ CRM Update Success:', data.success);
    } else {
        console.error('❌ CRM Update Failed:', res.status, JSON.stringify(data));
    }
}

testCrmUpdate(43091).catch(console.error);
