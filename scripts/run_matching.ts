
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { processUnmatchedCalls } from '../lib/call-matching';

async function run() {
    console.log('=== RUNNING CALL MATCHING ===');

    // Process in batches of 500
    // Loop until no more matches found or no more unmatched calls?
    // processUnmatchedCalls processes 'limit' unmatched calls.
    // If it finds 0 matches, it returns 0.
    // But there might be unmatched calls that simply don't match anything.
    // We should run this enough times to cover all unmatched calls.
    // I fetched ~1029 calls.
    // I'll run loop 5 times with batch 500. = 2500 calls.

    let totalMatched = 0;

    for (let i = 0; i < 10; i++) {
        console.log(`\n--- Batch ${i + 1} ---`);
        const matchedCount = await processUnmatchedCalls(500);
        totalMatched += matchedCount;

        console.log(`Batch ${i + 1} result: ${matchedCount} new matches.`);

        // If we processed 500 calls (limit) and found 0 matches, it's possible all 500 were unmatchable.
        // So we shouldn't stop just because matchedCount is 0, UNLESS we also know we processed 0 calls.
        // But processUnmatchedCalls doesn't return processed count.
        // It logs it though.
        // I will rely on the fact that I only have ~1000 calls to process.
        // 2 batches should be enough. 10 is safe.
        // Match logic queries UNMATCHED calls. So each run picks up DIFFERENT calls (those not yet matched).
        // If a call is processed but NOT matched, it stays "unmatched".
        // SO THE NEXT RUN WILL PICK IT UP AGAIN!
        // This causes an infinite loop if I just loop.
        // Ah! processUnmatchedCalls picks "unmatched" calls.
        // If I process a call and find NO match, it remains "unmatched" in DB (no record in call_order_matches).
        // So `processUnmatchedCalls` will pick it up AGAIN in the next iteration.
        // THIS IS A PROBLEM.

        // Fix: `processUnmatchedCalls` is designed for a cron that runs periodically.
        // If I want to backfill, I should probably iterate ALL calls once.
        // But `processUnmatchedCalls` logic is: 
        // 1. Get existing matches.
        // 2. Get unmatched calls involved in existing matches? No.
        // It gets IDs of currently matched calls.
        // Then it queries `raw_telphin_calls` filtering OUT those IDs.
        // So yes, it will pick up the same "unmatchable" calls forever if I loop.

        // So I should NOT loop blindly.
        // I should fetching ALL unmatched calls in one go?
        // Or I should implement a "processed" offset?
        // Like "offset" in the query?
        // But `processUnmatchedCalls` doesn't support offset.

        // However, the function `processUnmatchedCalls` is imported.
        // I can just import `matchCallToOrders` and `saveMatches` and implement my own loop with pagination.

        // That's better.
    }
}

// Rewriting run function to use manual pagination to avoid infinite loop on unmatchables
import { supabase } from '../utils/supabase';
import { matchCallToOrders, saveMatches, RawCall } from '../lib/call-matching';

async function runCorrectly() {
    console.log('=== RUNNING MATCHING BACKFILL (CORRECT) ===');

    // 1. Get IDs of known matches
    const { data: matches } = await supabase.from('call_order_matches').select('telphin_call_id');
    const matchedCallIds = new Set((matches || []).map(m => m.telphin_call_id));
    console.log(`Found ${matchedCallIds.size} existing matches.`);

    // 2. Iterate ALL raw calls using pagination
    let page = 0;
    const limit = 500;
    let hasMore = true;
    let newMatchesTotal = 0;
    let scannedTotal = 0;

    while (hasMore) {
        // Fetch page of calls
        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .order('started_at', { ascending: false })
            .range(page * limit, (page + 1) * limit - 1);

        if (error || !calls || calls.length === 0) {
            hasMore = false;
            break;
        }

        console.log(`Processing page ${page}: ${calls.length} calls...`);
        scannedTotal += calls.length;

        const callsToProcess = calls.filter(c => !matchedCallIds.has(c.telphin_call_id));

        // Process batch
        let batchMatches = 0;
        for (const call of callsToProcess) {
            const matches = await matchCallToOrders(call as RawCall);
            if (matches.length > 0) {
                await saveMatches(matches);
                batchMatches += matches.length;
                matchedCallIds.add(call.telphin_call_id); // Add to set so we don't process again if overlap
            }
        }

        newMatchesTotal += batchMatches;
        console.log(`  > Found ${batchMatches} matches in this page.`);

        page++;
    }

    console.log(`\n=== DONE ===`);
    console.log(`Scanned: ${scannedTotal}`);
    console.log(`New Matches: ${newMatchesTotal}`);
}

runCorrectly().catch(console.error);
