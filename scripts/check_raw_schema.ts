
import { supabase } from '@/utils/supabase';

async function checkRawSchema() {
    console.log('Checking raw_order_events table...');
    const { data, error } = await supabase
        .from('raw_order_events')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Keys:', Object.keys(data[0]));
    } else {
        console.log('raw_order_events table empty or keys not visible.');
    }
}

checkRawSchema();
