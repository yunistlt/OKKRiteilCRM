
import { supabase } from '../utils/supabase';

async function checkRawData() {
    console.log('Checking raw_order_events data...');
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(5);

    if (error) {
        console.error('Error:', error);
        return;
    }

    // ... events check ...
    console.log('--- raw_telphin_calls ---');
    const { data: calls, error: callError } = await supabase
        .from('raw_telphin_calls')
        .select('*')
        .limit(5);

    if (callError) {
        console.error('Call Error:', callError);
    } else {
        console.log(`Found ${calls?.length || 0} rows.`);
        if (calls && calls.length > 0) {
            console.log('Sample Call Row:', JSON.stringify(calls[0], null, 2));
        }
    }
}

checkRawData();
