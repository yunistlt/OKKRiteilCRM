
import { supabase } from './utils/supabase';

async function checkOrderPayload() {
    // Find an order for a corporate client
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, number, raw_payload, client_id')
        .not('client_id', 'is', null)
        .limit(3);
    
    if (error) {
        console.error('Error fetching orders:', error);
    } else {
        orders.forEach(o => {
            console.log(`Order ${o.number} (Client ${o.client_id}):`);
            // Check for customer/contactPerson in raw_payload
            console.log('Customer info in payload:', JSON.stringify(o.raw_payload?.customer, null, 2));
            console.log('Contact person in payload:', JSON.stringify(o.raw_payload?.contactPerson, null, 2));
        });
    }
}

checkOrderPayload();
