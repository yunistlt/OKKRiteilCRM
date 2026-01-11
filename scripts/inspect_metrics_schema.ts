
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectMetrics() {
    const { data, error } = await supabase
        .from('order_metrics')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Metrics Keys:', Object.keys(data[0]));
        console.log('Sample:', data[0]);
    } else {
        console.log('Metrics table empty or no access.');
    }
}

inspectMetrics();
