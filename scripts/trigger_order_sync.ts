
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const VERCEL_URL = 'https://okk-riteil-crm-aqwq.vercel.app';

async function triggerOrdersSync() {
    console.log('🚀 Triggering Full Order State Sync...');
    const url = `${VERCEL_URL}/api/sync/retailcrm`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Status: ${res.status}`);
            const txt = await res.text();
            console.error(txt);
            return;
        }
        const data = await res.json();
        console.log('✅ Result:', data);
    } catch (e) {
        console.error('Error:', e);
    }
}

triggerOrdersSync();
