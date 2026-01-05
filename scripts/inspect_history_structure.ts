
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTelphinToken } from '../lib/telphin';

async function run() {
    console.log('--- INSPECTING HISTORY STRUCTURE ---');
    const token = await getTelphinToken();
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userRes.json();
    const clientId = userData.client_id;

    // Request minimal history
    const params = new URLSearchParams({
        start_datetime: '2025-09-01 12:00:00',
        end_datetime: '2025-09-01 12:10:00',
        count: '5'
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/call_history/?${params.toString()}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();

    console.log('Is Array?', Array.isArray(data));
    if (!Array.isArray(data)) {
        console.log('Type:', typeof data);
        console.log('Keys:', Object.keys(data));
        console.log('Preview:', JSON.stringify(data, null, 2).substring(0, 500));
    } else {
        console.log('It IS an array of length:', data.length);
    }
}
run();
