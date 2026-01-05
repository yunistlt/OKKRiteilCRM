
import { supabase } from '@/utils/supabase';

async function checkOrdersPayload() {
    console.log('Checking orders table schema...');
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
        console.log('Orders table empty.');
    }
}

checkOrdersPayload();
