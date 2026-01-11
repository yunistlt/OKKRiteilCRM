
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectOrders() {
    console.log('Inspecting Orders Table...');

    // Check if we can verify the inserted order
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', 999555);

    console.log('Lookup 999555:', data, error);

    // Get 1 order to see keys
    const { data: sample } = await supabase.from('orders').select('*').limit(1);
    if (sample && sample.length > 0) {
        console.log('Order Keys:', Object.keys(sample[0]));
    }
}

inspectOrders();
