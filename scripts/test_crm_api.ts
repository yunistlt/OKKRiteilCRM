
import fetch from 'node-fetch';

const RETAILCRM_URL = 'https://zmktlt.retailcrm.ru';
const RETAILCRM_API_KEY = 'vOis25G2O34g98sO2R9E7O9V994s9V54'; // From your environment

async function test() {
    const idOrNumber = '48258';

    console.log(`Testing for ${idOrNumber}...`);

    // Test 1: By ID
    const urlIds = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&filter[ids][]=${idOrNumber}`;
    const resIds = await fetch(urlIds);
    const dataIds = await resIds.json();
    console.log('Result for filter[ids]:', dataIds.success, 'Count:', dataIds.orders?.length);

    // Test 2: By Number
    const urlNums = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_API_KEY}&filter[numbers][]=${idOrNumber}`;
    const resNums = await fetch(urlNums);
    const dataNums = await resNums.json();
    console.log('Result for filter[numbers]:', dataNums.success, 'Count:', dataNums.orders?.length);
    if (dataNums.orders?.[0]) {
        console.log('CRM Internal ID for this number:', dataNums.orders[0].id);
    }
}

test();
