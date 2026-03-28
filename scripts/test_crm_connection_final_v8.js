require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId, site) {
    console.log(`Verification V8: RAW JSON BODY (No wrapper key) for Customer ${customerId}`);
    
    // In some API v5 versions, the body IS the customer object
    const customerData = {
        customFields: {
            ai_reactivation_text: 'VERIFIED SEND V8: ' + new Date().toISOString()
        }
    };

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}&site=${site}`;
    
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData),
    });

    const data = await res.json();
    if (res.ok && data.success) {
        console.log('✅ CRM Update Success:', data.success);
    } else {
        console.error('❌ CRM Update Failed:', res.status, JSON.stringify(data));
    }
}

// Client 73036
testCrmUpdate(73036, 'zmktlt-ru').catch(console.error);
