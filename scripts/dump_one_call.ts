
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

async function run() {
    const token = await getTelphinToken();
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;

    // Fetch just 1 call
    const params = new URLSearchParams({
        start_datetime: '2025-09-01 10:00:00',
        end_datetime: '2025-09-01 11:00:00',
        limit: '1',
        count: '1'
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${params.toString()}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
        console.log('--- SAMPLE CALL ---');
        console.log(JSON.stringify(data[0], null, 2));
    } else {
        console.log('No data found in sample window');
    }
}
run();
