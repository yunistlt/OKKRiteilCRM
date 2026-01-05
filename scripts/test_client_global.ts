
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { getTelphinToken } from '../lib/telphin';

async function main() {
    console.log('--- TESTING GLOBAL CLIENT FETCH ---');
    const token = await getTelphinToken();

    // 1. Get Client ID
    console.log('Getting Client ID...');
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;
    console.log(`Client ID: ${clientId}`);

    if (!clientId) throw new Error('No client ID found');

    // 2. Fetch 1 hour of data (known busy time)
    // 2025-09-08 was the "stuck" day, let's try 12:00-13:00 UTC
    const fromD = '2025-09-08 12:00:00';
    const toD = '2025-09-08 13:00:00';

    const params = new URLSearchParams({
        start_datetime: fromD,
        end_datetime: toD,
        order: 'asc',
        count: '100'
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;
    console.log(`Fetching: ${url}`);

    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

    if (res.status === 429) {
        console.log('❌ Rate Limit (429)');
        return;
    }
    if (!res.ok) {
        console.log(`❌ Error: ${res.status}`);
        return;
    }

    const data = await res.json();
    console.log(`\nFound ${data.length} records.`);

    // Check extensions
    const extensions = new Set(data.map((r: any) => r.extension_id));
    console.log(`Unique Extensions involved: ${extensions.size}`);
    console.log('Extensions:', Array.from(extensions).join(', '));

    console.log('\nSample Record 0:');
    console.log(data[0]);
}

main();
