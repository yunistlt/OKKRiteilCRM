
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
// Fix aliases for ts-node
require('tsconfig-paths/register');

import { supabase } from '../utils/supabase';
import { matchCallToOrders, saveMatches, RawCall } from '../lib/call-matching';

async function runBackfillMatching() {
    console.log('=== HISTORICAL MATCHING WORKER (Sept 1 - Dec 1) ===');
    console.log('Running in continuous loop. Press Ctrl+C to stop.');

    // Config
    const START_DATE = '2025-09-01T00:00:00+00:00';
    const END_DATE = '2025-12-01T23:59:59+00:00';
    const BATCH_SIZE = 100;

    let PASS_COUNT = 0;

    while (true) {
        PASS_COUNT++;
        console.log(`\n\n--- STARTING PASS #${PASS_COUNT} ---`);

        let processedTotal = 0;
        let matchesTotal = 0;
        let hasMore = true;
        let offset = 0;

        // 1. Refresh "Already Matched" cache at start of each pass
        console.log('Refreshing matches index...');
        const { data: existing, error: existErr } = await supabase
            .from('call_order_matches')
            .select('telphin_call_id');

        if (existErr) {
            console.error('Index fetch error:', existErr);
            await new Promise(r => setTimeout(r, 5000)); // Sleep on error
            continue;
        }

        const matchedSet = new Set(existing?.map(x => x.telphin_call_id));
        console.log(`Index contains ${matchedSet.size} matched calls.`);

        // 2. Process range
        while (hasMore) {
            // console.log(`Fetching batch (Offset ${offset})...`);

            const { data: calls, error } = await supabase
                .from('raw_telphin_calls')
                .select('*')
                .gte('started_at', START_DATE)
                .lte('started_at', END_DATE)
                .order('started_at', { ascending: true }) // Oldest first
                .range(offset, offset + BATCH_SIZE - 1);

            if (error) {
                console.error('Fetch error:', error);
                break;
            }

            if (!calls || calls.length === 0) {
                hasMore = false;
                break; // End of this pass
            }

            // Filter out already matched
            const candidates = calls.filter(c => !matchedSet.has(c.telphin_call_id));

            if (candidates.length > 0) {
                process.stdout.write(`[Pass ${PASS_COUNT}] Processing ${candidates.length} calls... `);

                for (const call of candidates) {
                    const matches = await matchCallToOrders(call as RawCall);
                    if (matches.length > 0) {
                        await saveMatches(matches);
                        matchesTotal += matches.length;
                        matchedSet.add(call.telphin_call_id);
                        process.stdout.write('+');
                    } else {
                        process.stdout.write('.');
                    }
                }
                process.stdout.write('\n');
                processedTotal += candidates.length;
            }

            offset += BATCH_SIZE;
        }

        console.log(`Pass #${PASS_COUNT} Complete. New Matches: ${matchesTotal}`);

        // Sleep before next pass to avoid hammering if "faster than sync"
        console.log('Sleeping 10s before restart...');
        await new Promise(r => setTimeout(r, 10000));
    }
}

runBackfillMatching().catch(console.error);
