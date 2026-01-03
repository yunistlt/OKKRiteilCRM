
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function debugToken() {
    const TELPHIN_KEY = process.env.TELPHIN_APP_KEY;
    const TELPHIN_SECRET = process.env.TELPHIN_APP_SECRET;

    console.log('Requesting token...');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_KEY || '');
    params.append('client_secret', TELPHIN_SECRET || '');
    params.append('scope', 'all');

    const res = await fetch('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    const data = await res.json();
    console.log('Auth Response Keys:', Object.keys(data));
    console.log('Full Response:', JSON.stringify(data, null, 2));

    const token = data.access_token;

    // Check if key matches user proposal
    const USER_PROPOSED_ID = '17563e0a94a44493a84143032edb5e57';
    if (TELPHIN_KEY === USER_PROPOSED_ID) {
        console.log('✅ Current TELPHIN_APP_KEY matches the User Proposed ID.');
    } else {
        console.log(`⚠️ Current TELPHIN_APP_KEY (starts with ${TELPHIN_KEY?.substring(0, 4)}...) does NOT match User Proposed ID.`);
        console.log('If the Client Level fetch fails, we might need to switch keys (and get the secret).');
    }

    // 1. Get User Data to confirm Client ID
    console.log('\nFetching /user/ to confirm Client ID...');
    const userRes = await fetch('https://apiproxy.telphin.ru/api/ver1.0/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    let clientId = 10459; // Default from previous finding
    if (userRes.ok) {
        const userData = await userRes.json();
        console.log(`User ID: ${userData.id}, Client ID: ${userData.client_id}`);
        clientId = userData.client_id || clientId;
    } else {
        console.log('Failed to fetch user list:', userRes.status);
    }

    // 2. Try Client-Level Record Fetch
    console.log(`\nAttempting Global Fetch: /client/${clientId}/record ...`);
    // Try catching a small recent window
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    const paramsFetch = new URLSearchParams({
        start_datetime: fmt(yesterday),
        end_datetime: fmt(now),
        order: 'desc',
        count: '5'
    });

    const url = `https://apiproxy.telphin.ru/api/ver1.0/client/${clientId}/record/?${paramsFetch.toString()}`;
    console.log(`URL: ${url}`);

    const clientRes = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (clientRes.ok) {
        const clientData = await clientRes.json();
        console.log('✅ SUCCESS! Client-Level Fetch worked.');
        console.log(`Returned ${Array.isArray(clientData) ? clientData.length : 0} records.`);
        if (Array.isArray(clientData) && clientData.length > 0) {
            console.log('Sample Record:', JSON.stringify(clientData[0], null, 2));
        }
    } else {
        console.log(`❌ Failed to fetch client records: ${clientRes.status} ${clientRes.statusText}`);
        const txt = await clientRes.text();
        console.log('Error Body:', txt);
    }
}


debugToken().catch(console.error);
