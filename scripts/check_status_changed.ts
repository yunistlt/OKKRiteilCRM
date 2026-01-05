
import { supabase } from '@/utils/supabase';

async function checkStatusChanged() {
    console.log('Checking a status_changed event...');
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .eq('event_type', 'status_changed')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Event Payload:', JSON.stringify(data[0], null, 2));
    } else {
        console.log('No status_changed events found.');
    }
}

checkStatusChanged();
