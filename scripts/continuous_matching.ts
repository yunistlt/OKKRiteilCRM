
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';
import { matchCallToOrders, saveMatches, RawCall } from '../lib/call-matching';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function continuousMatching() {
    console.log('=== CONTINUOUS MATCHING SERVICE ===');
    console.log('Watching for new raw calls to match...\n');

    while (true) {
        // 1. Get IDs of known matches
        const { data: matches } = await supabase.from('call_order_matches').select('telphin_call_id');
        const matchedIds = new Set((matches || []).map(m => m.telphin_call_id));

        // 2. Fetch UNMATCHED calls (limit 200)
        // Note: This query is inefficient O(N) but fine for 17k rows.
        // Effective: Fetch recent calls, filter in memory.

        const { data: calls, error } = await supabase
            .from('raw_telphin_calls')
            .select('*')
            .order('ingested_at', { ascending: false }) // Prioritize recently ingested
            .limit(500);

        if (error || !calls) {
            console.error('Error fetching calls:', error);
            await sleep(10000);
            continue;
        }

        const unmatchedCalls = calls.filter(c => !matchedIds.has(c.telphin_call_id));

        if (unmatchedCalls.length === 0) {
            // Nothing to do, sleep longer
            process.stdout.write('.');
            await sleep(5000);
            continue;
        }

        console.log(`\nFound ${unmatchedCalls.length} recent unmatched calls.`);

        // Process
        let newMatches = 0;
        for (const call of unmatchedCalls) {
            const matches = await matchCallToOrders(call as RawCall);
            if (matches.length > 0) {
                await saveMatches(matches);
                newMatches += matches.length;
                matchedIds.add(call.telphin_call_id);
            }
        }

        if (newMatches > 0) {
            console.log(`> Created ${newMatches} matches.`);
        } else {
            console.log('> No matches found for this batch.');
        }

        await sleep(2000); // Small pause before next check
    }
}

continuousMatching().catch(console.error);
