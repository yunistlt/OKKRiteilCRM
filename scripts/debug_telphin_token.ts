
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
    const token = data.access_token;
    console.log('Got Token:', token ? 'YES' : 'NO');

    // 2. Try Extension-Level Record Fetch (loop top 5)
    // From route.ts
    const EXTENSIONS = [
        94413, 94415, 145748, 349957, 349963, 858926
    ];

    const now = new Date();
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 5); // Last 5 days

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    console.log(`\nChecking extensions from ${fmt(rangeStart)} to ${fmt(now)}...`);

    for (const extId of EXTENSIONS) {
        const paramsFetch = new URLSearchParams({
            start_datetime: fmt(rangeStart),
            end_datetime: fmt(now),
            order: 'desc',
        });

        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${paramsFetch.toString()}`;
        // console.log(`Checking Ext ${extId}...`);

        const extRes = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (extRes.ok) {
            const extData = await extRes.json();
            const count = Array.isArray(extData) ? extData.length : 0;
            console.log(` - Ext ${extId}: ${count} records.`);
            if (count > 0) {
                console.log(`   Sample: ${JSON.stringify(extData[0]).substring(0, 100)}...`);
            }
        } else {
            console.log(` - Ext ${extId}: FAILED ${extRes.status}`);
        }
    }
}


debugToken().catch(console.error);
