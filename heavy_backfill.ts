
import { supabase } from './utils/supabase';

async function run() {
    console.log('--- Starting Heavy Backfill ---');
    let totalProcessed = 0;
    let hasMore = true;

    while (hasMore) {
        try {
            console.log(`Processing next batch... (Total so far: ${totalProcessed})`);
            const res = await fetch('http://localhost:3000/api/analysis/amd/deep-audit?limit=30');
            const result = await res.json();

            if (result.processed > 0) {
                totalProcessed += result.processed;
                console.log(`Successfully processed ${result.processed} calls.`);
            } else {
                console.log('No more calls to process or no controlled managers found.');
                hasMore = false;
            }

            // Small delay to avoid CPU spikes
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error('Error in backfill loop:', e);
            hasMore = false;
        }
    }

    console.log(`--- Backfill Complete. Total Processed: ${totalProcessed} ---`);
}

run();
