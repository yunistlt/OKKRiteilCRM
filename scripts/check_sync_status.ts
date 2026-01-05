
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkSyncStatus() {
    console.log('=== CHECKING TELPHIN SYNC STATUS ===');

    // 1. Check Sync Cursor
    const { data: state, error: stateError } = await supabase
        .from('sync_state')
        .select('*')
        .eq('key', 'telphin_last_sync_time')
        .single();

    if (stateError) {
        console.error("Error fetching sync state:", stateError);
    } else {
        console.log(`Sync Cursor (telphin_last_sync_time): ${state?.value}`);
        console.log(`Last Updated: ${state?.updated_at}`);

        const cursorDate = new Date(state?.value);
        const now = new Date();
        const diffHours = (now.getTime() - cursorDate.getTime()) / (1000 * 60 * 60);
        console.log(`Lag: ${diffHours.toFixed(2)} hours`);
    }

    // 2. Check Latest Actual Call
    const { data: latestCall } = await supabase
        .from('raw_telphin_calls')
        .select('started_at, created_at')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

    if (latestCall) {
        console.log(`Latest Call in DB (started_at): ${latestCall.started_at}`);
        console.log(`Latest Call in DB (created_at/ingested): ${latestCall.created_at}`);
    } else {
        console.log("No calls found in DB.");
    }
}

checkSyncStatus().catch(console.error);
