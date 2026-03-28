require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId, site) {
    console.log(`Final Verification V9: by=id parameter for Customer ${customerId}`);
    
    // Exact match of train-route working pattern
    const customerData = {
        customFields: {
            ai_reactivation_text: 'VERIFIED SEND V9: ' + new Date().toISOString()
        }
    };

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}&by=id&site=${site}`;
    
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `customerCorporate=${encodeURIComponent(JSON.stringify(customerData))}`,
    });

    const data = await res.json();
    if (res.ok && data.success) {
        console.log('✅ CRM Update Success:', data.success);
    } else {
        console.error('❌ CRM Update Failed:', res.status, JSON.stringify(data));
    }
}

// Client 73036 on site zmktlt-ru
testCrmUpdate(73036, 'zmktlt-ru').catch(console.error);
