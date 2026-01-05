
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

    const params = new URLSearchParams({
        start_datetime: '2025-09-01 12:00:00',
        end_datetime: '2025-09-01 13:00:00',
        limit: '1',
        count: '1'
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    if (Array.isArray(data) && data.length > 0) {
        console.log('--- HISTORY ITEM KEYS ---');
        console.log(Object.keys(data[0]));
        console.log('--- SAMPLE VALUES ---');
        console.log('init_time_gmt:', data[0].init_time_gmt);
        console.log('start_time_gmt:', data[0].start_time_gmt);
        console.log('call_uuid:', data[0].call_uuid);
        console.log('record_uuid:', data[0].record_uuid);
    }
}
run();
