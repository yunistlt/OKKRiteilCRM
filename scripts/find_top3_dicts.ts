import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function probe() {
    const res = await fetch(`${RETAILCRM_URL}/api/v5/custom-fields?apiKey=${RETAILCRM_API_KEY}&limit=100`);
    const data = await res.json();

    if (data.success && data.customFields) {
        const top3Fields = data.customFields.filter((f: any) =>
            f.code.includes('top3') ||
            f.name.includes('ТОП3') ||
            f.name.includes('ТОП 3')
        );
        console.log(JSON.stringify(top3Fields, null, 2));

        if (top3Fields.length === 0) {
            console.log('No matches found. Showing first 10 fields to verify structure:');
            console.log(JSON.stringify(data.customFields.slice(0, 10), null, 2));
        }
    } else {
        console.log('Failed:', data);
    }
}

probe();
