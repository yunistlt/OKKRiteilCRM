
import { supabase } from './utils/supabase';

async function checkOrdersSchema() {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error fetching orders:', error);
    } else {
        console.log('Order columns:', Object.keys(data[0] || {}));
    }
}

checkOrdersSchema();
