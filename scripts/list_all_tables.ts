
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function listTables() {
    console.log('--- ANALYSIS: Listing All Tables ---');

    // We can't query information_schema directly with supabase-js simple client usually, 
    // unless we use rpc or if we have permissions on a view.
    // But we can try a hack: query a known table that lists tables? No.
    // Or we use the `pg` driver if we had it.

    // Since we don't have direct schema access, I will just list "known candidates" and check if they exist by selecting 1 row.
    // Candidates:
    const candidates = [
        // LEGACY
        'calls',
        'matches',
        'matches_deprecated',
        'order_history',
        'order_changes',
        'manager_kpi',
        'kpi_logs',

        // NEW (RAW)
        'raw_telphin_calls',
        'raw_order_events',

        // NEW (INTERPRETED)
        'call_order_matches',
        'order_metrics',
        'orders',

        // SYSTEM / CONFIG
        'status_settings',
        'managers',
        'sync_state',

        // RULE ENGINE
        'okk_rules',
        'okk_violations'
    ];

    for (const table of candidates) {
        const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (error) {
            // Likely table doesn't exist (code 404 or 42P01 in pg)
            // Supabase returns error object.
            if (error.code === '42P01') {
                console.log(`[MISSING] ${table}`);
            } else {
                console.log(`[ERROR/MISSING] ${table}: ${error.message}`);
            }
        } else {
            console.log(`[EXISTS] ${table}: ${count} rows`);
        }
    }
}

listTables();
