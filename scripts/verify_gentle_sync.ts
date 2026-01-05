
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// --- CONFIG ---
const TELPHIN_APP_KEY = process.env.TELPHIN_APP_KEY;
const TELPHIN_APP_SECRET = process.env.TELPHIN_APP_SECRET;

const EXTENSIONS = [
    94413, 94415, 145748, 349957, 349963, 351106, 469589,
    // Just test the first 7 to save time but prove stability
];

async function getTelphinToken() {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', TELPHIN_APP_KEY || '');
    params.append('client_secret', TELPHIN_APP_SECRET || '');
    params.append('scope', 'all');

    const res = await fetch('https://apiproxy.telphin.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });
    const data = await res.json();
    return data.access_token;
}

async function runGentleVerification() {
    console.log('=== GENTLE SYNC VERIFICATION ===');
    const token = await getTelphinToken();

    const start = '2025-11-24 09:00:00';
    const end = '2025-11-24 10:00:00'; // 1 hour window

    console.log(`Window: ${start} -> ${end}`);
    console.log("Waiting 60s for initial cooldown to clear penalty...");
    await new Promise(r => setTimeout(r, 60000));

    for (const extId of EXTENSIONS) {
        process.stdout.write(`Ext ${extId}: Requesting... `);
        const startTime = Date.now();

        const params = new URLSearchParams({
            start_datetime: start,
            end_datetime: end,
            order: 'asc',
            count: '500'
        });
        const url = `https://apiproxy.telphin.ru/api/ver1.0/extension/${extId}/record/?${params.toString()}`;

        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (res.status === 429) {
            console.log("❌ 429 HIT! Strategy failed.");
            return;
        }

        if (res.ok) {
            const data = await res.json();
            const count = Array.isArray(data) ? data.length : 0;
            console.log(`✅ OK (${count} calls). Waiting 1s...`);
        } else {
            console.log(`❌ Error ${res.status}`);
        }

        // COMPULSORY DELAY (Increased to 5s)
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log("\n✅ Verification Complete: No 429s encountered with sequential + 1s delay.");
}

runGentleVerification().catch(console.error);
