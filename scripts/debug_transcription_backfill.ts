
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
require('tsconfig-paths/register');
import { supabase } from '../utils/supabase';

async function main() {
    console.log('--- DEBUG TRANSCRIPTION BACKFILL ---');

    // 1. Check State
    const { data: state, error: stateError } = await supabase
        .from('sync_state')
        .select('*')
        .in('key', ['transcription_backfill_cursor', 'transcription_min_duration']);

    if (stateError) console.error('State Error:', stateError);

    const cursor = state?.find(s => s.key === 'transcription_backfill_cursor')?.value || '2025-09-01T00:00:00+00:00';
    console.log(`Cursor: ${cursor}`);

    // 2. Check Working Statuses
    const { data: statuses, error: statusError } = await supabase.from('status_settings').select('code, is_working');
    if (statusError) {
        console.error('Status Error:', statusError);
        return;
    }

    // Check if table is empty
    if (!statuses || statuses.length === 0) {
        console.warn('WARNING: status_settings table is empty!');
    }

    const working = statuses?.filter(s => s.is_working).map(s => s.code) || [];
    console.log(`Working Statuses (${working.length}):`, working.join(', '));

    if (working.length === 0) {
        console.error('CRITICAL: No working statuses enabled. Backfill will find nothing.');
    }

    // 3. Simulating Query (With Validated Inputs)
    console.log('Simulating Query...');
    const { data: candidates, error } = await supabase
        .from('raw_telphin_calls')
        .select(`
            telphin_call_id,
            started_at,
            duration_sec,
            call_order_matches!inner (
                orders!inner (
                    status
                )
            )
        `)
        .gt('started_at', cursor)
        .gt('duration_sec', 15)
        .in('call_order_matches.orders.status', working)
        .order('started_at', { ascending: true })
        .limit(5);

    if (error) {
        console.error('Query Error:', error);
    } else {
        console.log(`Found ${candidates?.length} candidates.`);
        candidates?.forEach(c => {
            // @ts-ignore
            const status = c.call_order_matches[0]?.orders?.status;
            console.log(`- ${c.started_at} (${c.duration_sec}s) Status: ${status}`);
        });
    }

    // 4. Analyze Barriers (Why are we blocked?)
    console.log('\n--- DIAGNOSTICS ---');
    // Check next 10 matched calls IGNORING filters to see what they are
    const { data: nextCalls } = await supabase
        .from('raw_telphin_calls')
        .select(`
            started_at,
            duration_sec,
            call_order_matches!inner (
                orders!inner (
                    status
                )
            )
        `)
        .gt('started_at', cursor)
        .order('started_at', { ascending: true })
        .limit(10);

    if (nextCalls && nextCalls.length > 0) {
        console.log(`Next 10 calls in DB (Raw + Match):`);
        nextCalls.forEach(c => {
            // @ts-ignore
            const status = c.call_order_matches[0]?.orders?.status;
            const isWorking = working.includes(status);
            const isLongEnough = (c.duration_sec || 0) > 15;
            console.log(`[${c.started_at}] Dur: ${c.duration_sec}s (${isLongEnough ? 'OK' : 'SHORT'}), Status: ${status} (${isWorking ? 'OK' : 'SKIP'})`);
        });
    } else {
        console.log('No matched calls found after cursor.');
    }
}

main();
