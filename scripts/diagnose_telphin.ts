
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env

import { supabase } from '@/utils/supabase';
import { runTelphinSync } from '@/lib/sync/telphin';

async function diagnose() {
    console.log('--- Telphin Sync Diagnosis ---');

    // 1. Check Env Vars
    const hasKey = !!(process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID);
    const hasSecret = !!(process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET);
    console.log(`Env Vars: KEY=${hasKey} (TELPHIN_APP_KEY=${!!process.env.TELPHIN_APP_KEY}, TELPHIN_CLIENT_ID=${!!process.env.TELPHIN_CLIENT_ID})`);
    console.log(`Env Vars: SECRET=${hasSecret} (TELPHIN_APP_SECRET=${!!process.env.TELPHIN_APP_SECRET}, TELPHIN_CLIENT_SECRET=${!!process.env.TELPHIN_CLIENT_SECRET})`);

    // 2. Check Sync State
    const { data: state, error } = await supabase
        .from('sync_state')
        .select('*')
        .eq('key', 'telphin_last_sync_time')
        .single();

    if (error) {
        console.error('Error fetching sync state:', error.message);
    } else {
        console.log('Current Sync Cursor:', state?.value);
        console.log('Last Updated:', state?.updated_at);

        // Check if cursor is stuck in the past
        const cursorDate = new Date(state?.value);
        const now = new Date();
        const diffMs = now.getTime() - cursorDate.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        console.log(`Gap: ${diffMins} minutes behind.`);

        if (diffMins > 60) {
            console.warn('!!! WARNING: Sync is lagging by more than an hour.');
        }
    }

    // 3. Dry Run Sync
    console.log('\n--- Attempting Sync (Dry Run) ---');
    try {
        const result = await runTelphinSync();
        console.log('Sync Result:', JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.error('Sync FAILED:', e);
    }
}

diagnose();
