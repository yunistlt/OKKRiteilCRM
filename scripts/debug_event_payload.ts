
import { supabase } from '../utils/supabase';

async function debugPayload() {
    console.log('Fetching one raw_order_event...');
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No events found.');
        return;
    }

    const event = data[0];
    console.log('Event Type:', event.event_type);
    console.log('Payload Keys:', Object.keys(event.raw_payload));
    console.log('Payload Sample:', JSON.stringify(event.raw_payload, null, 2).slice(0, 500) + '...');
}

debugPayload();
