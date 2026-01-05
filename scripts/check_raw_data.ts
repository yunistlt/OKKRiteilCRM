
import { supabase } from '@/utils/supabase';

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

    console.log(`Found ${data?.length || 0} rows.`);
    if (data && data.length > 0) {
        console.log('Sample Row:', JSON.stringify(data[0], null, 2));
    }
}

checkRawData();
