require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY ?? '';

async function testCrmUpdate(customerId) {
    console.log(`Final Verification V7: NO SITE parameter for Customer ${customerId}`);
    
    const customerData = {
        customFields: {
            ai_reactivation_text: 'VERIFIED SEND V7: ' + new Date().toISOString()
        }
    };

    const url = `${RETAILCRM_URL}/api/v5/customers-corporate/${customerId}/edit?apiKey=${RETAILCRM_API_KEY}`;
    
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

// Client 73034
testCrmUpdate(73034).catch(console.error);
