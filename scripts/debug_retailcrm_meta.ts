import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function debugFields() {
    console.log('--- CUSTOM FIELDS ---');
    const cfRes = await fetch(`${RETAILCRM_URL}/api/v5/custom-fields?apiKey=${RETAILCRM_API_KEY}`);
    const cfData = await cfRes.json();
    console.log(JSON.stringify(cfData.customFields, null, 2));

    console.log('\n--- ORDER METHODS ---');
    const omRes = await fetch(`${RETAILCRM_URL}/api/v5/reference/order-methods?apiKey=${RETAILCRM_API_KEY}`);
    const omData = await omRes.json();
    console.log(JSON.stringify(omData, null, 2));
}

debugFields();
