
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkRaw() {
    // Check 5 calls that have some payload keys indicating real data
    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .not('raw_payload', 'is', null) // ensure payload exists
        .order('event_id', { ascending: false })
        .limit(5);

    if (data && data.length > 0) {
        console.log(`Found ${data.length} calls.`);
        data.forEach((row, i) => {
            const p = row.raw_payload;
            // Check all possible locations
            const url = row.recording_url || p?.recording_url || p?.record_url || p?.storage_url || p?.url;
            console.log(`Call ${i}: ID=${row.telphin_call_id} URL=${url ? 'FOUND' : 'MISSING'} (${url || 'null'})`);
            if (i === 0) {
                console.log('Sample Payload Keys:', Object.keys(p || {}));
                console.log('Sample Row Keys:', Object.keys(row));
            }
        });
    } else {
        console.log('No data or error:', error);
    }
}

checkRaw();
