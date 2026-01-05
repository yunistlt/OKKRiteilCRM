
import { supabase } from '@/utils/supabase';

async function checkManagerCommentInPayload() {
    console.log('Checking orders.raw_payload content...');
    const { data, error } = await supabase
        .from('orders')
        .select('order_id, raw_payload')
        .not('raw_payload', 'is', null)
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Order ID:', data[0].order_id);
        console.log('Payload Keys:', Object.keys(data[0].raw_payload));
        console.log('Manager Comment:', data[0].raw_payload.managerComment);
    } else {
        console.log('No orders with payload found.');
    }
}

checkManagerCommentInPayload();
