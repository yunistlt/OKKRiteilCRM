import { processUnmatchedCalls } from '../lib/call-matching';

async function run() {
    console.log('--- MASS RE-MATCHING PROCESS ---');
    console.log('Starting re-matching for the last 5 days...');

    // We increase the limit to process more calls if needed
    const matchedCount = await processUnmatchedCalls(500);

    console.log(`\nProcess finished. Total matches found: ${matchedCount}`);
}

run().catch(console.error);
