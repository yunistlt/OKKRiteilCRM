
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function checkCounts() {
    const { count: callsCount, error: err1 } = await supabase.from('raw_telphin_calls').select('*', { count: 'exact', head: true });
    if (err1) console.error('calls error:', err1);

    const { count: eventsCount, error: err2 } = await supabase.from('raw_order_events').select('*', { count: 'exact', head: true });
    if (err2) console.error('events error:', err2);

    const { count: matchesCount, error: err3 } = await supabase.from('call_order_matches').select('*', { count: 'exact', head: true });
    if (err3) console.error('matches error:', err3);

    console.log('=== DATA COUNTS ===');
    console.log(`Raw Calls: ${callsCount}`);
    console.log(`Raw Order Events: ${eventsCount}`);
    console.log(`Matches: ${matchesCount}`);

    // Check if raw_order_events has normalized phones
    const { data: sampleEvent } = await supabase
        .from('raw_order_events')
        .select('phone_normalized')
        .not('phone_normalized', 'is', null)
        .limit(1);

    console.log('Has normalized phones in events?', !!(sampleEvent && sampleEvent.length > 0));
}

checkCounts();
