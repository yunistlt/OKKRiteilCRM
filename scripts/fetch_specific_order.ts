import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function fetchOrder() {
    const res = await fetch(`${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&filter[numbers][]=46831`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

fetchOrder();
