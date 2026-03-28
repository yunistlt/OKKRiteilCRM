
import { supabase } from './utils/supabase';

async function checkSpecificOrder() {
    const { data: order, error } = await supabase
        .from('orders')
        .select('id, number, raw_payload')
        .eq('number', '37074')
        .single();
    
    if (order) {
        console.log('Order 37074 RAW Payload Extract:');
        console.log('Customer:', JSON.stringify(order.raw_payload?.customer, null, 2));
        console.log('Contact Person:', JSON.stringify(order.raw_payload?.contactPerson, null, 2));
        // Check if there is an association with a corporate customer ID
        console.log('Corporate Customer ID (if any):', order.raw_payload?.customer?.corporate?.id);
    }
}

checkSpecificOrder();
