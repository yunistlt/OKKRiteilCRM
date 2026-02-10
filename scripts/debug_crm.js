
require('dotenv').config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
    console.error('Missing env vars');
    process.exit(1);
}

async function testFetch(days) {
    const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
    const defaultLookback = new Date();
    defaultLookback.setDate(defaultLookback.getDate() - days);

    // Test format: YYYY-MM-DD HH:mm:ss
    const filterDateFrom = defaultLookback.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`Testing with date: ${filterDateFrom} (days: ${days})`);

    const params = new URLSearchParams();
    params.append('apiKey', RETAILCRM_API_KEY);
    params.append('limit', '20');
    params.append('page', '1');
    params.append('filter[createdAtFrom]', filterDateFrom);

    // Also try without filter just to see if it works
    // params.append('filter[dateFrom]', filterDateFrom); // Alternative

    const url = `${baseUrl}/api/v5/customers-corporate?${params.toString()}`;
    console.log(`URL: ${url}`);

    try {
        const res = await fetch(url);
        if (!res.ok) {
            const txt = await res.text();
            console.error(`Error ${res.status}:`, txt);
        } else {
            const data = await res.json();
            console.log('Success:', data.success);
            if (data.customersCorporate) {
                console.log(`Count: ${data.customersCorporate.length}`);
            } else {
                console.log('Response OK but no customersCorporate field:', Object.keys(data));
            }
        }
    } catch (e) {
        console.error(e);
    }
}

// Test with 30 days
testFetch(30);
