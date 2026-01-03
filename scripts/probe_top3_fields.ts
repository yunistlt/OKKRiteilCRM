import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function probe() {
    console.log('🔍 Probing for TOP3 fields in Order Custom Fields...');
    const res = await fetch(`${RETAILCRM_URL}/api/v5/custom-fields/orders?apiKey=${RETAILCRM_API_KEY}`);
    const data = await res.json();

    if (data.success && data.customFields) {
        const top3 = data.customFields.filter((f: any) => f.name.includes('ТОП3'));
        console.log('Found fields:', JSON.stringify(top3, null, 2));
    } else {
        console.log('Failed:', data);
    }
}

probe();
