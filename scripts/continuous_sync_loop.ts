
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const VERCEL_URL = 'https://okk-riteil-crm-aqwq.vercel.app';

async function loopSync() {
    console.log('🔄 Starting Continuous Sync Loop...');

    // Start form Nov 1st initially (the API will ignore this if a checkpoint exists in DB)
    let startDateParam = '2025-11-01';
    let iteration = 1;
    let totalSyncedGlobal = 0;

    while (true) {
        console.log(`\n--- Iteration ${iteration} ---`);
        const syncUrl = `${VERCEL_URL}/api/sync/telphin?force=true&start_date=${startDateParam}`;

        try {
            console.log(`📡 Requesting: ${syncUrl}`);
            const res = await fetch(syncUrl);

            if (!res.ok) {
                console.error(`❌ API Error: ${res.status} ${res.statusText}`);
                const text = await res.text();
                console.error(text);
                // Wait a bit before retry
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const data = await res.json();

            const count = data.total_synced || 0;
            totalSyncedGlobal += count;

            console.log(`✅ Success! Synced: ${count} calls.`);
            console.log(`📍 Cursor moved to: ${data.final_cursor}`);
            console.log(`📊 Session Total: ${totalSyncedGlobal}`);

            if (data.completed_fully) {
                console.log('🎉 SYNC COMPLETE! We reached "now".');
                break;
            }

            // Update start_date param for next iteration using the returned cursor
            if (data.final_cursor) {
                startDateParam = data.final_cursor;
                console.log(`⏩ Advancing to: ${startDateParam}`);
            }

        } catch (e) {
            console.error('💥 Network/Script Error:', e);
            await new Promise(r => setTimeout(r, 5000));
        }

        iteration++;
        await new Promise(r => setTimeout(r, 1000)); // Short pause
    }
}

loopSync();
