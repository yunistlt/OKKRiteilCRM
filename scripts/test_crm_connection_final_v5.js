require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId, site) {
    console.log(`Final Verification V5: Serialized JSON for Customer ${customerId} on site ${site}`);
    
    const customerData = {
        customFields: {
            ai_reactivation_text: 'VERIFIED SEND V5: ' + new Date().toISOString()
        }
    };

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('site', site);
    params.set('customerCorporate', JSON.stringify(customerData));

    // Try URL with apiKey and site in query string
    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}&site=${site}`;
    
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

// Trying customer 73034
testCrmUpdate(73034, 'zmktlt-ru').catch(console.error);
