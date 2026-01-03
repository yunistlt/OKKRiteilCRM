import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function debugFields() {
    const endpoints = [
        '/api/v5/custom-fields',
        '/api/v5/custom-fields/order',
        '/api/v5/custom-fields/orders',
        '/api/v4/custom-fields/order',
        '/api/v5/reference/product-groups'
    ];

    for (const ep of endpoints) {
        console.log(`\n--- TRYING ${ep} ---`);
        try {
            // New logic for custom-fields with limit=100
            if (ep === '/api/v5/custom-fields') {
                console.log('--- CUSTOM FIELDS ---');
                const cfRes = await fetch(`${RETAILCRM_URL}/api/v5/custom-fields?apiKey=${RETAILCRM_API_KEY}&limit=100`);
                const cfData = await cfRes.json();
                console.log(`Total count: ${cfData.pagination?.totalCount}`);

                const fields = cfData.customFields || [];
                const relevant = fields.filter((f: any) =>
                    ['typ_castomer', 'sfera_deiatelnosti', 'kategoria_klienta_po_vidu', 'product_category', 'client_category'].includes(f.code)
                );
                console.log(JSON.stringify(relevant, null, 2));

                // Also log all codes to be sure
                console.log('ALL CODES:', fields.map((f: any) => f.code).join(', '));
                console.log('\n--- LISTING DICTIONARIES ---');
                const dRes = await fetch(`${RETAILCRM_URL}/api/v5/reference/dictionaries?apiKey=${RETAILCRM_API_KEY}`);
                const dData = await dRes.json();
                console.log(JSON.stringify(dData, null, 2));
            } else {
                // Original logic for other endpoints
                const res = await fetch(`${RETAILCRM_URL}${ep}?apiKey=${RETAILCRM_API_KEY}`);
                const data = await res.json();
                console.log(`Success: ${data.success}`);
                if (data.success) {
                    // Print a bit of data to verify, increased substring length
                    console.log(JSON.stringify(data, null, 2).substring(0, 2000));
                    if (data.customFields) {
                        const found = data.customFields.find((f: any) => f.code === 'typ_castomer');
                        if (found) console.log('FOUND typ_castomer:', JSON.stringify(found, null, 2));
                    }
                } else {
                    console.log('Error:', data.errorMsg || data.error?.message);
                }
            }
        } catch (e: any) {
            console.log('Exception:', e.message);
        }
    }
}

debugFields();
