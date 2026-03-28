
import { supabase } from './utils/supabase';

async function checkOrderAll() {
    const { data: order } = await supabase
        .from('orders')
        .select('raw_payload')
        .eq('number', '37074')
        .single();
    
    if (order) {
        console.log('Full keys in raw_payload:', Object.keys(order.raw_payload));
        // Check standard contact fields
        console.log('Email:', order.raw_payload?.email);
        console.log('Phone:', order.raw_payload?.phone);
        // Check if there are other suspected fields
        if (order.raw_payload?.contact) {
            console.log('Contact field exists:', JSON.stringify(order.raw_payload.contact, null, 2));
        }
    }
}

checkOrderAll();
