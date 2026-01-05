
import { supabase } from '@/utils/supabase';

async function checkOrdersSchema() {
    console.log('Checking orders table...');
    // Try to select one order to see keys
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Keys:', Object.keys(data[0]));
    } else {
        console.log('Orders table empty or keys not visible.');
    }
}

checkOrdersSchema();
