require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId, site) {
    console.log(`Final Verification: Update Customer ${customerId} on site ${site}`);
    
    const customerData = {
        customFields: {
            ai_reactivation_text: 'VERIFIED SEND MECHANISM: ' + new Date().toISOString()
        }
    };

    const params = new URLSearchParams();
    params.set('apiKey', RETAILCRM_API_KEY);
    params.set('site', site);
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

// Client 73036 is on zmktlt-ru
testCrmUpdate(73036, 'zmktlt-ru').catch(console.error);
