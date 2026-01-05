
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function diagnose() {
    console.log('=== DIAGNOSING UNMATCHED CALLS ===');

    // 1. Get IDs of known matches
    const { data: matches } = await supabase.from('call_order_matches').select('telphin_call_id');
    const matchedCallIds = new Set((matches || []).map(m => m.telphin_call_id));

    // 2. Check call date range
    const { data: oldestCall } = await supabase
        .from('raw_telphin_calls')
        .select('started_at')
        .order('started_at', { ascending: true })
        .limit(1);

    const { data: newestCall } = await supabase
        .from('raw_telphin_calls')
        .select('started_at')
        .order('started_at', { ascending: false })
        .limit(1);

    console.log(`Oldest Call: ${oldestCall?.[0]?.started_at}`);
    console.log(`Newest Call: ${newestCall?.[0]?.started_at}`);

    // Check months counts
    // ... complex query or just sample

    // 2. Fetch recent calls (excluding TEST calls if possible, or just fetch more)
    const { data: calls, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .not('telphin_call_id', 'like', 'TEST-CALL%') // Filter out test calls
        .order('started_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error("Error fetching calls:", error);
        return;
    }

    const unmatched = calls.filter(c => !matchedCallIds.has(c.telphin_call_id));

    console.log(`Fetched 50 recent calls. Found ${unmatched.length} UNMATCHED.`);

    // 3. Output details of first 5 unmatched for inspection
    unmatched.slice(0, 5).forEach(c => {
        console.log(`\n-------------------------------------------------`);
        console.log(`Call ID: ${c.telphin_call_id}`);
        console.log(`Time: ${c.started_at}`);
        console.log(`From: ${c.from_number || c.from_pin} | To: ${c.to_number || c.to_pin}`);
        console.log(`Raw: ${JSON.stringify(c).substring(0, 150)}...`);
    });

    console.log(`\nTo inspect a specific call, verify if orders existed around that time.`);
}

diagnose().catch(console.error);
