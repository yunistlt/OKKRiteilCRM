import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function probe() {
    // According to RetailCRM API (or at least common patterns):
    const variants = [
        '/api/v5/reference/order-methods',
        '/api/v5/reference/statuses',
        '/api/v5/reference/custom-dictionaries', // Often this is the one for custom fields
        '/api/v5/reference/dictionaries',
    ];

    for (const v of variants) {
        console.log(`\nTesting ${v}...`);
        const res = await fetch(`${RETAILCRM_URL}${v}?apiKey=${RETAILCRM_API_KEY}`);
        const data = await res.json();
        console.log(`Success: ${data.success}`);
        if (data.success) {
            console.log(JSON.stringify(data, null, 2).substring(0, 1000));
        }
    }
}

probe();
