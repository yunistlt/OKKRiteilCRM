
import { supabase } from '@/utils/supabase';

async function checkMetrics() {
    console.log('Checking order_metrics table...');
    const { data, error } = await supabase
        .from('order_metrics')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Keys:', Object.keys(data[0]));
    } else {
        console.log('order_metrics table empty or keys not visible.');
    }
}

checkMetrics();
