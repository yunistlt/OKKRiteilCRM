
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { supabase } from '../utils/supabase';

async function main() {
    console.log('--- DIAGNOSING BACKFILL PROGRESS ---');

    // 1. Check Cursor
    const { data: state } = await supabase
        .from('sync_state')
        .select('*')
        .in('key', ['telphin_backfill_cursor', 'telphin_backfill_ext_index'])
        .maybeSingle(); // This might return one or null if multiple? .in returns array.

    // Fix: .in returns array
    const { data: states } = await supabase
        .from('sync_state')
        .select('*')
        .in('key', ['telphin_backfill_cursor', 'telphin_backfill_ext_index']);

    console.log('\n1. SYNC STATE:');
    states?.forEach(s => console.log(`   ${s.key}: ${s.value} (Updated: ${s.updated_at})`));

    // 2. Check Total Count
    const { count: total, error: countErr } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true });

    console.log(`\n2. TOTAL CALLS: ${total} (Error: ${countErr?.message || 'None'})`);

    // 3. Check Recent Activity (Ingested in last 10 mins)
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: recentCount, error: recentErr } = await supabase
        .from('raw_telphin_calls')
        .select('*', { count: 'exact', head: true })
        .gt('ingested_at', tenMinsAgo);

    console.log(`\n3. RECENTLY INGESTED (<10m): ${recentCount} calls`);

    // 4. Check Latest Calls (by started_at)
    const { data: latestCalls } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, telphin_call_id, created_at, ingested_at')
        .order('started_at', { ascending: false })
        .limit(3);

    console.log('\n4. NEWEST CALLS (by Call Time):');
    latestCalls?.forEach(c => console.log(`   ${c.started_at} (Ingested: ${c.ingested_at})`));

    // 5. Check "Spinning" (Calls ingested recently but with OLD start dates?)
    const { data: reIngested } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, telphin_call_id, ingested_at')
        .gt('ingested_at', tenMinsAgo)
        .order('started_at', { ascending: true }) // Oldest first
        .limit(3);

    if (reIngested && reIngested.length > 0) {
        console.log('\n5. RECENTLY UPDATED/INSERTED (Sample):');
        reIngested.forEach(c => console.log(`   Call Time: ${c.started_at} | Ingested: ${c.ingested_at}`));

        // Check if cursor matches these timestamps
        // If Call Time < Cursor, we might be re-fetching history?
    } else {
        console.log('\n5. No recent ingestions found.');
    }
}

main();
